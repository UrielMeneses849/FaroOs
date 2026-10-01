-- A previous legacy backfill could stamp old completed tasks with the day the
-- migration ran. Recover the most reliable available historical timestamp so
-- Smart Cleaner can remove completed work after its normal three-day grace.
update public.tasks
set completed_at = coalesce(updated_at, created_at, completed_at)
where status = 'done'
  and updated_at <= clock_timestamp() - interval '3 days'
  and (completed_at is null or completed_at > updated_at + interval '1 day');

create or replace function public.faro_task_smart_cleaner()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scanned_count integer := 0;
  eligible_count integer := 0;
  cleaned_count integer := 0;
  missing_count integer := 0;
  cleaned_ids uuid[] := '{}';
begin
  -- Repair records created before completed_at was consistently written.
  update public.tasks
  set completed_at = coalesce(updated_at, created_at, clock_timestamp())
  where user_id = auth.uid()
    and status = 'done'
    and completed_at is null;

  select count(*), count(*) filter (where completed_at <= clock_timestamp() - interval '3 days')
  into scanned_count, eligible_count
  from public.tasks
  where user_id = auth.uid() and status = 'done';

  with removed as (
    delete from public.tasks
    where user_id = auth.uid()
      and status = 'done'
      and completed_at <= clock_timestamp() - interval '3 days'
    returning id
  ) select coalesce(array_agg(id), '{}'), count(*) into cleaned_ids, cleaned_count from removed;

  insert into public.faro_task_cleaner_runs(user_id, scanned, eligible, cleaned, skipped_missing_completed_at, errors)
  values (auth.uid(), scanned_count, eligible_count, cleaned_count, missing_count, 0);

  return jsonb_build_object('cleaned_ids', cleaned_ids, 'scanned', scanned_count, 'eligible', eligible_count,
    'cleaned', cleaned_count, 'skipped_missing_completed_at', missing_count, 'errors', 0);
end;
$$;
