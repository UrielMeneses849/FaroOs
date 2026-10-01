-- Version liquidity baselines so formula upgrades never compare unlike models.
-- Existing snapshots remain as v1 audit records; the corrected carry-forward
-- engine writes a new immutable v2 baseline for the same month.

alter table public.finance_liquidity_snapshots
  add column if not exists projection_version integer not null default 1;

alter table public.finance_liquidity_snapshots
  drop constraint if exists finance_liquidity_snapshots_one_per_month;

alter table public.finance_liquidity_snapshots
  drop constraint if exists finance_liquidity_snapshots_projection_version_positive;

alter table public.finance_liquidity_snapshots
  add constraint finance_liquidity_snapshots_projection_version_positive
  check (projection_version > 0);

alter table public.finance_liquidity_snapshots
  drop constraint if exists finance_liquidity_snapshots_one_per_month_version;

alter table public.finance_liquidity_snapshots
  add constraint finance_liquidity_snapshots_one_per_month_version
  unique (user_id, month, projection_version);

-- Keep older clients functional and isolated on the v1 baseline.
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
    user_id,
    month,
    projection_version,
    initial_projected_minimum,
    initial_projected_closing_balance
  ) values (
    target_user_id,
    normalized_month,
    1,
    target_minimum,
    target_closing
  ) on conflict (user_id, month, projection_version) do nothing;

  select * into snapshot
  from public.finance_liquidity_snapshots
  where user_id = target_user_id
    and month = normalized_month
    and projection_version = 1;

  return snapshot;
end;
$$;

create or replace function public.capture_finance_liquidity_snapshot_v2(
  target_month date,
  target_minimum numeric,
  target_closing numeric,
  target_projection_version integer
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
  if target_projection_version < 2 then
    raise exception 'Projection version must be 2 or greater.';
  end if;

  insert into public.finance_liquidity_snapshots (
    user_id,
    month,
    projection_version,
    initial_projected_minimum,
    initial_projected_closing_balance
  ) values (
    target_user_id,
    normalized_month,
    target_projection_version,
    target_minimum,
    target_closing
  ) on conflict (user_id, month, projection_version) do nothing;

  select * into snapshot
  from public.finance_liquidity_snapshots
  where user_id = target_user_id
    and month = normalized_month
    and projection_version = target_projection_version;

  return snapshot;
end;
$$;

revoke all on function public.capture_finance_liquidity_snapshot_v2(date, numeric, numeric, integer) from public;
grant execute on function public.capture_finance_liquidity_snapshot_v2(date, numeric, numeric, integer) to authenticated;

notify pgrst, 'reload schema';
