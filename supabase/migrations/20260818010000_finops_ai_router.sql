-- FARO FinOps v1 extends the existing Voice observability table instead of
-- creating another telemetry datastore. No prompt, transcript or tool args are
-- persisted here.
alter table public.faro_ai_request_metrics
  add column if not exists module text,
  add column if not exists feature text,
  add column if not exists tier_requested text,
  add column if not exists tier_used text,
  add column if not exists fallback_reason text,
  add column if not exists escalated boolean not null default false,
  add column if not exists avoided_llm_call boolean not null default false,
  add column if not exists error_type text,
  add column if not exists cost_status text not null default 'unknown';

-- Preserve historical data while making the old route names legible as tiers.
update public.faro_ai_request_metrics
set
  module = coalesce(module, skill),
  feature = coalesce(feature, intent),
  tier_requested = coalesce(tier_requested, case route
    when 'deterministic' then 'deterministic'
    when 'cheap_model' then 'cheap'
    when 'smart_model' then 'standard'
    else 'premium'
  end),
  tier_used = coalesce(tier_used, case
    when route = 'deterministic' then 'deterministic'
    when provider is not null then 'premium'
    when route = 'cheap_model' then 'cheap'
    when route = 'smart_model' then 'standard'
    else 'premium'
  end),
  avoided_llm_call = avoided_llm_call or route = 'deterministic',
  cost_status = case
    when route = 'deterministic' then 'not_applicable'
    when estimated_cost_usd is null then 'unknown'
    else 'known'
  end;

create index if not exists faro_ai_request_metrics_user_tier_idx
  on public.faro_ai_request_metrics (user_id, tier_used, created_at desc);
create index if not exists faro_ai_request_metrics_user_module_idx
  on public.faro_ai_request_metrics (user_id, module, created_at desc);

-- One configurable monthly budget per FARO user. It is intentionally small and
-- local to the existing Supabase project rather than a separate FinOps system.
create table if not exists public.faro_ai_budgets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_budget_usd numeric(14,8) not null check (monthly_budget_usd > 0),
  updated_at timestamptz not null default now()
);

alter table public.faro_ai_budgets enable row level security;
drop policy if exists "Users read own FARO AI budget" on public.faro_ai_budgets;
drop policy if exists "Users insert own FARO AI budget" on public.faro_ai_budgets;
drop policy if exists "Users update own FARO AI budget" on public.faro_ai_budgets;
create policy "Users read own FARO AI budget" on public.faro_ai_budgets
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own FARO AI budget" on public.faro_ai_budgets
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own FARO AI budget" on public.faro_ai_budgets
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update on public.faro_ai_budgets to authenticated;

create or replace function public.faro_set_ai_budget(p_monthly_budget_usd numeric)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if p_monthly_budget_usd is null or p_monthly_budget_usd <= 0 then
    raise exception 'Monthly AI budget must be positive';
  end if;
  insert into public.faro_ai_budgets (user_id, monthly_budget_usd, updated_at)
  values (uid, p_monthly_budget_usd, now())
  on conflict (user_id) do update
    set monthly_budget_usd = excluded.monthly_budget_usd, updated_at = now();
  return jsonb_build_object('monthlyBudgetUsd', p_monthly_budget_usd);
end;
$$;

create or replace function public.faro_finops_dashboard(p_period text default 'month')
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  start_at timestamptz;
  end_at timestamptz;
  month_start timestamptz := date_trunc('month', now());
  month_end timestamptz := date_trunc('month', now()) + interval '1 month';
  budget numeric(14,8);
  response jsonb;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if p_period = 'today' then
    start_at := date_trunc('day', now()); end_at := start_at + interval '1 day';
  elsif p_period = 'last_7_days' then
    start_at := date_trunc('day', now()) - interval '6 days'; end_at := date_trunc('day', now()) + interval '1 day';
  elsif p_period = 'month' then
    start_at := month_start; end_at := month_end;
  else
    raise exception 'Invalid FinOps period';
  end if;

  select monthly_budget_usd into budget from public.faro_ai_budgets where user_id = uid;

  with rows as (
    select * from public.faro_ai_request_metrics
    where user_id = uid and created_at >= start_at and created_at < end_at
  ), month_rows as (
    select * from public.faro_ai_request_metrics
    where user_id = uid and created_at >= month_start and created_at < month_end
  ), totals as (
    select
      count(*)::int as requests,
      count(*) filter (where used_llm)::int as ai_requests,
      count(*) filter (where avoided_llm_call)::int as avoided_calls,
      count(*) filter (where used_llm and estimated_cost_usd is null)::int as unknown_cost_requests,
      coalesce(sum(estimated_cost_usd), 0)::numeric as known_cost_usd,
      coalesce(avg(estimated_cost_usd) filter (where used_llm and estimated_cost_usd is not null), 0)::numeric as average_cost_usd,
      avg(total_latency_ms) filter (where used_llm and total_latency_ms is not null) as average_latency_ms,
      coalesce(count(*) filter (where used_llm and tier_used = 'premium')::numeric / nullif(count(*) filter (where used_llm), 0), 0) as premium_rate,
      count(*) filter (where escalated)::int as escalations,
      count(*) filter (where not success)::int as failed_requests,
      percentile_cont(.5) within group (order by total_latency_ms) filter (where total_latency_ms is not null) as latency_p50_ms,
      case when count(*) filter (where total_latency_ms is not null) >= 20
        then percentile_cont(.95) within group (order by total_latency_ms) filter (where total_latency_ms is not null)
        else null end as latency_p95_ms
    from rows
  ), month_totals as (
    select
      coalesce(sum(estimated_cost_usd), 0)::numeric as known_cost_usd,
      count(*) filter (where used_llm and estimated_cost_usd is null)::int as unknown_cost_requests
    from month_rows
  )
  select jsonb_build_object(
    'periodStart', start_at,
    'periodEnd', end_at,
    'totals', (select to_jsonb(totals) from totals),
    'tiers', coalesce((select jsonb_agg(to_jsonb(x) order by x.tier) from (
      select tier_used as tier, count(*)::int as requests,
        coalesce(sum(estimated_cost_usd), 0)::numeric as known_cost_usd,
        count(*) filter (where used_llm and estimated_cost_usd is null)::int as unknown_cost_requests,
        count(*) filter (where tier_requested <> tier_used)::int as escalated_requests
      from rows where used_llm or avoided_llm_call group by tier_used
    ) x), '[]'::jsonb),
    'providers', coalesce((select jsonb_agg(to_jsonb(x) order by x.known_cost_usd desc, x.provider, x.model) from (
      select coalesce(provider, 'deterministic') as provider, coalesce(model, '—') as model,
        count(*)::int as requests, coalesce(sum(input_tokens), 0)::bigint as input_tokens,
        coalesce(sum(output_tokens), 0)::bigint as output_tokens, coalesce(sum(cached_input_tokens), 0)::bigint as cached_tokens,
        coalesce(sum(estimated_cost_usd), 0)::numeric as known_cost_usd,
        count(*) filter (where used_llm and estimated_cost_usd is null)::int as unknown_cost_requests,
        avg(total_latency_ms) filter (where total_latency_ms is not null) as average_latency_ms
      from rows group by provider, model
    ) x), '[]'::jsonb),
    'modules', coalesce((select jsonb_agg(to_jsonb(x) order by x.known_cost_usd desc, x.module) from (
      select coalesce(module, skill, 'other') as module, count(*)::int as requests,
        coalesce(sum(estimated_cost_usd), 0)::numeric as known_cost_usd,
        count(*) filter (where used_llm and estimated_cost_usd is null)::int as unknown_cost_requests,
        mode() within group (order by tier_used) as predominant_tier
      from rows group by coalesce(module, skill, 'other')
    ) x), '[]'::jsonb),
    'features', coalesce((select jsonb_agg(to_jsonb(x) order by x.known_cost_usd desc, x.feature) from (
      select coalesce(feature, intent, 'unknown') as feature, count(*)::int as requests,
        coalesce(sum(estimated_cost_usd), 0)::numeric as known_cost_usd,
        count(*) filter (where used_llm and estimated_cost_usd is null)::int as unknown_cost_requests,
        coalesce(avg(estimated_cost_usd) filter (where estimated_cost_usd is not null), 0)::numeric as average_cost_usd,
        avg(total_latency_ms) filter (where total_latency_ms is not null) as average_latency_ms,
        mode() within group (order by tier_used) as predominant_tier
      from rows group by coalesce(feature, intent, 'unknown')
    ) x), '[]'::jsonb),
    'tokensOverTime', coalesce((select jsonb_agg(to_jsonb(x) order by x.day) from (
      select created_at::date as day, coalesce(sum(input_tokens), 0)::bigint as input_tokens,
        coalesce(sum(output_tokens), 0)::bigint as output_tokens,
        coalesce(sum(cached_input_tokens), 0)::bigint as cached_tokens
      from rows group by created_at::date
    ) x), '[]'::jsonb),
    'escalations', coalesce((select jsonb_agg(to_jsonb(x) order by x.requests desc) from (
      select tier_requested as requested_tier, tier_used as used_tier,
        coalesce(fallback_reason, route_reason, 'tier_escalation') as reason, count(*)::int as requests
      from rows where escalated or tier_requested <> tier_used
      group by tier_requested, tier_used, coalesce(fallback_reason, route_reason, 'tier_escalation')
    ) x), '[]'::jsonb),
    'errors', coalesce((select jsonb_agg(to_jsonb(x) order by x.requests desc) from (
      select coalesce(error_type, error_code, 'unknown') as error_type,
        coalesce(provider, 'deterministic') as provider, count(*)::int as requests
      from rows where not success group by coalesce(error_type, error_code, 'unknown'), coalesce(provider, 'deterministic')
    ) x), '[]'::jsonb),
    'optimizationOpportunity', jsonb_build_object(
      'requests', (select count(*)::int from rows where fallback_reason = 'provider_not_configured' and tier_requested in ('cheap', 'standard') and tier_used = 'premium'),
      'reason', 'provider_not_configured'
    ),
    'history', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select created_at, coalesce(module, skill, 'other') as module, coalesce(feature, intent, 'unknown') as feature,
        intent, tier_requested, tier_used, provider, model, input_tokens, output_tokens, cached_input_tokens,
        estimated_cost_usd, cost_status, total_latency_ms, success, error_type, fallback_reason, escalated
      from rows order by created_at desc limit 100
    ) x), '[]'::jsonb),
    'budget', jsonb_build_object(
      'monthlyBudgetUsd', budget,
      'monthKnownCostUsd', (select known_cost_usd from month_totals),
      'monthUnknownCostRequests', (select unknown_cost_requests from month_totals),
      'percentageUsed', case when budget is null then null else (select known_cost_usd from month_totals) / budget end,
      'projectedKnownCostUsd', (select known_cost_usd from month_totals) * extract(day from month_end - month_start) / greatest(extract(day from now() - month_start) + 1, 1)
    )
  ) into response;
  return response;
end;
$$;

revoke all on function public.faro_set_ai_budget(numeric) from public;
revoke all on function public.faro_finops_dashboard(text) from public;
grant execute on function public.faro_set_ai_budget(numeric) to authenticated;
grant execute on function public.faro_finops_dashboard(text) to authenticated;
notify pgrst, 'reload schema';
