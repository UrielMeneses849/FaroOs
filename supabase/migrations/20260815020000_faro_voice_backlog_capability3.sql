-- Capability 3: a task remains the single source of truth for its optional
-- Calendar projection (`due_at` + `estimated_minutes`). Calendar entries are
-- deliberately not created for scheduled tasks.

alter table public.tasks
  add column if not exists completed_at timestamptz;

-- Legacy `done` rows were created before `completed_at` was reliable. There is
-- no task-status audit table to safely recover the real completion moment, so
-- the migration timestamp is intentionally used as a grace-period fallback.
-- This prevents an immediate bulk delete; each legacy task becomes eligible
-- only two days after this migration, unless it is reopened first.
update public.tasks
set completed_at = now()
where status = 'done'
  and completed_at is null;

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
      -- A title, schedule, or priority edit must not restart the cleaner clock.
      new.completed_at := old.completed_at;
    end if;
  else
    -- Reopening a task makes it ineligible immediately.
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

create table if not exists public.faro_task_cleaner_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  scanned integer not null default 0,
  eligible integer not null default 0,
  cleaned integer not null default 0,
  skipped_missing_completed_at integer not null default 0,
  errors integer not null default 0
);

create index if not exists faro_task_cleaner_runs_user_started_idx
  on public.faro_task_cleaner_runs (user_id, started_at desc);

alter table public.faro_task_cleaner_runs enable row level security;
drop policy if exists "Users can read own FARO task cleaner runs" on public.faro_task_cleaner_runs;
create policy "Users can read own FARO task cleaner runs"
  on public.faro_task_cleaner_runs for select to authenticated
  using ((select auth.uid()) = user_id);

-- Preserves the existing hard-delete behavior, now with the correct two-day
-- clock. It is safe to call repeatedly: only currently eligible rows are
-- returned/deleted and every invocation records its own metrics.
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
  cleaned_ids uuid[] := '{}';
  missing_count integer := 0;
begin
  if uid is null then raise exception 'Authentication required'; end if;

  select count(*) filter (where status = 'done'),
         count(*) filter (where status = 'done' and completed_at is null),
         count(*) filter (where status = 'done' and completed_at <= now() - interval '2 days')
  into scanned_count, missing_count, eligible_count
  from public.tasks
  where user_id = uid;

  with deleted as (
    delete from public.tasks
    where user_id = uid
      and status = 'done'
      and completed_at is not null
      and completed_at <= now() - interval '2 days'
    returning id
  )
  select coalesce(array_agg(id), '{}') into cleaned_ids from deleted;

  insert into public.faro_task_cleaner_runs(
    user_id, scanned, eligible, cleaned, skipped_missing_completed_at, errors
  ) values (
    uid, scanned_count, eligible_count, coalesce(array_length(cleaned_ids, 1), 0), missing_count, 0
  );

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

revoke all on function public.faro_task_smart_cleaner() from public;
grant execute on function public.faro_task_smart_cleaner() to authenticated;

-- Service-only, all-user runner for pg_cron. It shares the exact eligibility
-- predicate with the user-scoped RPC, and is never exposed to browser roles.
create or replace function public.faro_task_smart_cleaner_all()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  total_scanned integer := 0;
  total_eligible integer := 0;
  total_cleaned integer := 0;
  total_missing integer := 0;
  cleaned_count integer;
begin
  for candidate in
    select user_id,
      count(*) filter (where status = 'done')::integer as scanned,
      count(*) filter (where status = 'done' and completed_at is null)::integer as missing,
      count(*) filter (where status = 'done' and completed_at <= now() - interval '2 days')::integer as eligible
    from public.tasks
    group by user_id
  loop
    with deleted as (
      delete from public.tasks
      where user_id = candidate.user_id
        and status = 'done'
        and completed_at is not null
        and completed_at <= now() - interval '2 days'
      returning id
    ) select count(*) into cleaned_count from deleted;

    insert into public.faro_task_cleaner_runs(user_id, scanned, eligible, cleaned, skipped_missing_completed_at, errors)
    values (candidate.user_id, candidate.scanned, candidate.eligible, cleaned_count, candidate.missing, 0);

    total_scanned := total_scanned + candidate.scanned;
    total_eligible := total_eligible + candidate.eligible;
    total_cleaned := total_cleaned + cleaned_count;
    total_missing := total_missing + candidate.missing;
  end loop;

  return jsonb_build_object('scanned', total_scanned, 'eligible', total_eligible, 'cleaned', total_cleaned, 'skipped_missing_completed_at', total_missing, 'errors', 0);
end;
$$;

revoke all on function public.faro_task_smart_cleaner_all() from public, anon, authenticated;
grant execute on function public.faro_task_smart_cleaner_all() to service_role;

-- Hosted Supabase normally provides pg_cron. Local/dev projects without it
-- still have the same idempotent RPC above; the exception keeps migration
-- deployment portable.
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

-- Reuses the isolated Calendar setup and adds Backlog-specific candidates. The
-- former legacy-null condition is covered by the cleaner policy tests; new Lab
-- writes correctly receive the trigger-managed completion timestamp instead of
-- manufacturing a broken production-shaped row.
create or replace function public.prepare_ai_calendar_scenario(
  p_anchor_date date default current_date,
  p_confirm_is_test_user boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  faro_workspace_id uuid;
  bimsa_workspace_id uuid;
  personal_workspace_id uuid;
  tomorrow date := p_anchor_date + 1;
  full_day date := p_anchor_date + 2;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if not p_confirm_is_test_user then raise exception 'Confirm that this is a dedicated test user'; end if;

  insert into public.workspaces(user_id,name,type,color,is_active,sort_order)
  values(uid,'FARO OS','personal','#2868ff',true,1)
  on conflict(user_id,name) do update set is_active=true,color=excluded.color
  returning id into faro_workspace_id;
  insert into public.workspaces(user_id,name,type,color,is_active,sort_order)
  values(uid,'BIMSA','business','#ff9718',true,2)
  on conflict(user_id,name) do update set is_active=true,color=excluded.color
  returning id into bimsa_workspace_id;
  insert into public.workspaces(user_id,name,type,color,is_active,sort_order)
  values(uid,'Personal','personal','#57a34b',true,3)
  on conflict(user_id,name) do update set is_active=true,color=excluded.color
  returning id into personal_workspace_id;

  delete from public.calendar_entries where user_id=uid and title like '[LAB]%';
  delete from public.tasks where user_id=uid and title like '[LAB]%';
  delete from public.calendar_voice_fixtures where user_id=uid;

  insert into public.calendar_entries(user_id,workspace_id,kind,title,starts_at,ends_at,all_day)
  values
    (uid,bimsa_workspace_id,'event','[LAB] Reunión BIMSA',make_timestamptz(extract(year from tomorrow)::int,extract(month from tomorrow)::int,extract(day from tomorrow)::int,10,0,0,'America/Mexico_City'),make_timestamptz(extract(year from tomorrow)::int,extract(month from tomorrow)::int,extract(day from tomorrow)::int,11,0,0,'America/Mexico_City'),false),
    (uid,faro_workspace_id,'focus','[LAB] Bloque FARO',make_timestamptz(extract(year from tomorrow)::int,extract(month from tomorrow)::int,extract(day from tomorrow)::int,13,0,0,'America/Mexico_City'),make_timestamptz(extract(year from tomorrow)::int,extract(month from tomorrow)::int,extract(day from tomorrow)::int,14,30,0,'America/Mexico_City'),false),
    (uid,faro_workspace_id,'event','[LAB] Reunión de seguimiento',make_timestamptz(extract(year from full_day)::int,extract(month from full_day)::int,extract(day from full_day)::int,9,0,0,'America/Mexico_City'),make_timestamptz(extract(year from full_day)::int,extract(month from full_day)::int,extract(day from full_day)::int,12,0,0,'America/Mexico_City'),false),
    (uid,faro_workspace_id,'event','[LAB] Reunión de revisión',make_timestamptz(extract(year from full_day)::int,extract(month from full_day)::int,extract(day from full_day)::int,12,0,0,'America/Mexico_City'),make_timestamptz(extract(year from full_day)::int,extract(month from full_day)::int,extract(day from full_day)::int,18,0,0,'America/Mexico_City'),false);

  insert into public.tasks(user_id,workspace_id,title,area,status,priority,due_at,estimated_minutes)
  values
    (uid,faro_workspace_id,'[LAB] Preparar demo de FARO','personal','todo','medium',make_timestamptz(extract(year from tomorrow)::int,extract(month from tomorrow)::int,extract(day from tomorrow)::int,15,0,0,'America/Mexico_City'),60),
    (uid,faro_workspace_id,'[LAB] Preparar aplicación de Mac','personal','todo','high',null,120),
    (uid,bimsa_workspace_id,'[LAB] Revisar ETL','personal','todo','high',null,60),
    (uid,bimsa_workspace_id,'[LAB] Revisar reporte','personal','blocked','medium',null,45),
    (uid,bimsa_workspace_id,'[LAB] Revisar diseño','personal','todo','medium',null,45),
    (uid,personal_workspace_id,'[LAB] Tarea completada reciente','personal','done','low',null,30);

  insert into public.calendar_voice_fixtures(user_id,title,starts_at,ends_at,source,calendar_id,external_id,etag)
  values(uid,'[LAB Google] Daily externo',make_timestamptz(extract(year from tomorrow)::int,extract(month from tomorrow)::int,extract(day from tomorrow)::int,17,0,0,'America/Mexico_City'),make_timestamptz(extract(year from tomorrow)::int,extract(month from tomorrow)::int,extract(day from tomorrow)::int,17,30,0,'America/Mexico_City'),'google','lab-google','lab-daily','"lab-etag-1"');

  return jsonb_build_object('anchorDate',p_anchor_date,'tomorrow',tomorrow,'fullDay',full_day,'workspaceId',faro_workspace_id,'faroWorkspaceId',faro_workspace_id,'bimsaWorkspaceId',bimsa_workspace_id,'personalWorkspaceId',personal_workspace_id);
end;
$$;

revoke all on function public.prepare_ai_calendar_scenario(date,boolean) from public;
grant execute on function public.prepare_ai_calendar_scenario(date,boolean) to authenticated;

notify pgrst, 'reload schema';
