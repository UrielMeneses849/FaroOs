-- Persist the simplified FARO health check-in without losing its food-quality signal.
alter table public.health_logs
  add column if not exists food_quality text
    check (food_quality is null or food_quality in ('good', 'okay', 'bad'));

create index if not exists health_logs_user_date_idx
  on public.health_logs(user_id, log_date desc, created_at desc);
