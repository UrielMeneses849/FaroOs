-- FARO Desktop/Web hot fix: completed tasks expire three full days after the
-- transition to `done`. The migration is deliberately idempotent and records
-- its preflight/cleanup outcome in the existing cleaner audit table.

alter table public.tasks
  add column if not exists completed_at timestamptz;

-- The previous trigger protects transition semantics, so suspend it only while
-- backfilling legacy rows that genuinely have no completion timestamp. updated_at
-- is the best available historic signal; clamping it to now prevents a corrupt
-- future date from extending a task's retention window.
alter table public.tasks disable trigger faro_tasks_completed_at_guard;
update public.tasks
set completed_at = least(updated_at, clock_timestamp())
where status = 'done'
  and completed_at is null;
alter table public.tasks enable trigger faro_tasks_completed_at_guard;

create or replace function public.faro_guard_task_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status is distinct from 'done' then
      new.completed_at := clock_timestamp();
    else
      -- Editing an already completed task never restarts the retention clock.
      new.completed_at := old.completed_at;
    end if;
  else
    -- Reopening immediately removes the task from cleanup eligibility.
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists faro_tasks_completed_at_guard on public.tasks;
create trigger faro_tasks_completed_at_guard
before insert or update on public.tasks
for each row execute function public.faro_guard_task_completed_at();

create index if not exists tasks_done_completed_at_idx
  on public.tasks (user_id, completed_at)
  where status = 'done' and completed_at is not null;

create or replace function public.faro_task_smart_cleaner()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  scanned_count integer := 0;
  eligible_count integer := 0;
  missing_count integer := 0;
  cleaned_ids uuid[] := '{}';
begin
  if uid is null then raise exception 'Authentication required'; end if;

  select count(*) filter (where status = 'done'),
         count(*) filter (where status = 'done' and completed_at is null),
         count(*) filter (where status = 'done' and completed_at <= clock_timestamp() - interval '3 days')
  into scanned_count, missing_count, eligible_count
  from public.tasks
  where user_id = uid;

  with deleted as (
    delete from public.tasks
    where user_id = uid
      and status = 'done'
      and completed_at is not null
      and completed_at <= clock_timestamp() - interval '3 days'
    returning id
  )
  select coalesce(array_agg(id), '{}') into cleaned_ids from deleted;

  insert into public.faro_task_cleaner_runs(user_id, scanned, eligible, cleaned, skipped_missing_completed_at, errors)
  values (uid, scanned_count, eligible_count, coalesce(array_length(cleaned_ids, 1), 0), missing_count, 0);

  return jsonb_build_object(
    'scanned', scanned_count,
    'eligible', eligible_count,
    'cleaned', coalesce(array_length(cleaned_ids, 1), 0),
    'cleaned_ids', to_jsonb(cleaned_ids),
    'skipped_missing_completed_at', missing_count,
    'errors', 0
  );
end;
$$;

create or replace function public.faro_task_smart_cleaner_all()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  cleaned_count integer;
  total_scanned integer := 0;
  total_eligible integer := 0;
  total_cleaned integer := 0;
  total_missing integer := 0;
begin
  for candidate in
    select user_id,
      count(*) filter (where status = 'done')::integer as scanned,
      count(*) filter (where status = 'done' and completed_at is null)::integer as missing,
      count(*) filter (where status = 'done' and completed_at <= clock_timestamp() - interval '3 days')::integer as eligible
    from public.tasks
    group by user_id
  loop
    with deleted as (
      delete from public.tasks
      where user_id = candidate.user_id
        and status = 'done'
        and completed_at is not null
        and completed_at <= clock_timestamp() - interval '3 days'
      returning id
    ) select count(*) into cleaned_count from deleted;

    insert into public.faro_task_cleaner_runs(user_id, scanned, eligible, cleaned, skipped_missing_completed_at, errors)
    values (candidate.user_id, candidate.scanned, candidate.eligible, cleaned_count, candidate.missing, 0);

    total_scanned := total_scanned + candidate.scanned;
    total_eligible := total_eligible + candidate.eligible;
    total_cleaned := total_cleaned + cleaned_count;
    total_missing := total_missing + candidate.missing;
  end loop;

  return jsonb_build_object(
    'scanned', total_scanned,
    'eligible', total_eligible,
    'cleaned', total_cleaned,
    'skipped_missing_completed_at', total_missing,
    'errors', 0
  );
end;
$$;

-- This service-only preflight remains available for operational checks without
-- exposing another user's task metadata to browser clients.
create or replace function public.faro_task_smart_cleaner_preflight_all()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'scanned', count(*) filter (where status = 'done'),
    'eligible', count(*) filter (where status = 'done' and completed_at <= clock_timestamp() - interval '3 days'),
    'missing_completed_at', count(*) filter (where status = 'done' and completed_at is null)
  )
  from public.tasks;
$$;

revoke all on function public.faro_task_smart_cleaner_all() from public, anon, authenticated;
grant execute on function public.faro_task_smart_cleaner_all() to service_role;
revoke all on function public.faro_task_smart_cleaner_preflight_all() from public, anon, authenticated;
grant execute on function public.faro_task_smart_cleaner_preflight_all() to service_role;

-- Replace the former two-day schedule. The client RPC is a convenience only;
-- this schedule makes the policy independent of opening Backlog.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute 'select cron.unschedule(jobid) from cron.job where jobname = $1'
      using 'faro-task-smart-cleaner-daily';
    execute 'select cron.schedule($1, $2, $3)'
      using 'faro-task-smart-cleaner-daily', '15 3 * * *', 'select public.faro_task_smart_cleaner_all();';
  end if;
exception when undefined_function or undefined_table or insufficient_privilege then
  raise notice 'pg_cron is unavailable; FARO task cleaner remains callable through its idempotent RPC.';
end;
$$;

-- Migration preflight and one immediate, audited historical cleanup. `NOTICE`
-- preserves the exact counts in the migration log before the delete executes.
do $$
declare
  preflight jsonb;
  cleanup jsonb;
begin
  select public.faro_task_smart_cleaner_preflight_all() into preflight;
  raise notice 'FARO Smart Cleaner preflight: %', preflight;
  select public.faro_task_smart_cleaner_all() into cleanup;
  raise notice 'FARO Smart Cleaner cleanup: %', cleanup;
end;
$$;

notify pgrst, 'reload schema';
