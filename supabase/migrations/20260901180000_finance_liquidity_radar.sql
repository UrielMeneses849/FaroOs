-- FARO Finanzas: user-owned liquidity guardrail and immutable month snapshots.
-- Values are numeric MXN so the existing finance repository can convert them to cents.
create table if not exists public.finance_liquidity_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  minimum_operating_buffer numeric(14,2) not null default 15000,
  updated_at timestamptz not null default now(),
  constraint finance_liquidity_preferences_buffer_non_negative check (minimum_operating_buffer >= 0)
);

create table if not exists public.finance_liquidity_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null,
  initial_projected_minimum numeric(14,2) not null,
  initial_projected_closing_balance numeric(14,2) not null,
  snapshot_date timestamptz not null default now(),
  constraint finance_liquidity_snapshots_month_starts_on_first check (month = date_trunc('month', month)::date),
  constraint finance_liquidity_snapshots_one_per_month unique (user_id, month)
);

create index if not exists finance_liquidity_snapshots_user_month_idx
  on public.finance_liquidity_snapshots (user_id, month desc);

drop trigger if exists finance_liquidity_preferences_updated_at on public.finance_liquidity_preferences;
create trigger finance_liquidity_preferences_updated_at
before update on public.finance_liquidity_preferences
for each row execute function public.set_updated_at();

alter table public.finance_liquidity_preferences enable row level security;
alter table public.finance_liquidity_snapshots enable row level security;

create policy "Users manage their finance liquidity preferences"
on public.finance_liquidity_preferences
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users read their finance liquidity snapshots"
on public.finance_liquidity_snapshots
for select to authenticated
using ((select auth.uid()) = user_id);

-- The only writer: creates the first valid reading and never overwrites it.
create or replace function public.capture_finance_liquidity_snapshot(
  target_month date,
  target_minimum numeric,
  target_closing numeric
)
returns public.finance_liquidity_snapshots
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot public.finance_liquidity_snapshots;
  target_user_id uuid := auth.uid();
  normalized_month date := date_trunc('month', target_month)::date;
begin
  if target_user_id is null then
    raise exception 'Authentication is required.';
  end if;
  if target_month <> normalized_month then
    raise exception 'Snapshot month must be the first day of its month.';
  end if;

  insert into public.finance_liquidity_snapshots (
    user_id, month, initial_projected_minimum, initial_projected_closing_balance
  ) values (
    target_user_id, normalized_month, target_minimum, target_closing
  ) on conflict (user_id, month) do nothing;

  select * into snapshot
  from public.finance_liquidity_snapshots
  where user_id = target_user_id and month = normalized_month;

  return snapshot;
end;
$$;

revoke all on function public.capture_finance_liquidity_snapshot(date, numeric, numeric) from public;
grant execute on function public.capture_finance_liquidity_snapshot(date, numeric, numeric) to authenticated;
grant select, insert, update on public.finance_liquidity_preferences to authenticated;
grant select on public.finance_liquidity_snapshots to authenticated;
