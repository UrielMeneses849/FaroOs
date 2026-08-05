-- Health records are private to their owner. These explicit policies repair
-- environments where the table exists but CRUD grants/policies were incomplete.
alter table public.health_logs enable row level security;

grant select, insert, update, delete on table public.health_logs to authenticated;

drop policy if exists "FARO users can read own health logs" on public.health_logs;
create policy "FARO users can read own health logs"
  on public.health_logs for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "FARO users can insert own health logs" on public.health_logs;
create policy "FARO users can insert own health logs"
  on public.health_logs for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "FARO users can update own health logs" on public.health_logs;
create policy "FARO users can update own health logs"
  on public.health_logs for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "FARO users can delete own health logs" on public.health_logs;
create policy "FARO users can delete own health logs"
  on public.health_logs for delete
  to authenticated
  using ((select auth.uid()) = user_id);
