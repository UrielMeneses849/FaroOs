-- FARO AI Cost Observatory v1: operational metadata is separated from voice_action_logs,
-- which retains the legacy action audit trail and can contain conversation text.
create table if not exists public.faro_ai_request_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  session_id uuid,
  created_at timestamptz not null default now(),
  source text not null check (source in ('text', 'voice')),
  surface text not null,
  pipeline text not null default 'optimized' check (pipeline in ('legacy', 'optimized')),
  benchmark_scenario text,
  skill text not null check (skill in ('finance', 'calendar', 'backlog', 'unknown')),
  intent text not null,
  route text not null check (route in ('deterministic', 'cheap_model', 'smart_model', 'reasoning_model')),
  route_reason text not null,
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  provider text,
  model text,
  used_llm boolean not null default false,
  input_tokens integer,
  cached_input_tokens integer,
  output_tokens integer,
  stt_provider text,
  stt_latency_ms numeric(12,2),
  routing_latency_ms numeric(12,2),
  context_latency_ms numeric(12,2),
  llm_latency_ms numeric(12,2),
  tool_latency_ms numeric(12,2),
  tts_provider text,
  tts_latency_ms numeric(12,2),
  total_latency_ms numeric(12,2),
  success boolean not null default false,
  error_code text,
  fallback boolean not null default false,
  estimated_cost_usd numeric(14,8),
  cost_is_estimated boolean not null default false,
  unique (user_id, request_id)
);

create index if not exists faro_ai_request_metrics_user_created_idx
  on public.faro_ai_request_metrics(user_id, created_at desc);
create index if not exists faro_ai_request_metrics_user_route_idx
  on public.faro_ai_request_metrics(user_id, route, created_at desc);
create index if not exists faro_ai_request_metrics_user_benchmark_idx
  on public.faro_ai_request_metrics(user_id, benchmark_scenario, pipeline, created_at desc)
  where benchmark_scenario is not null;

alter table public.faro_ai_request_metrics enable row level security;
create policy "Users read own FARO AI metrics" on public.faro_ai_request_metrics
  for select to authenticated using ((select auth.uid()) = user_id);
-- The edge function writes with the service-role key after validating the caller.
-- Browser clients can only read their own aggregates/rows.
grant select on public.faro_ai_request_metrics to authenticated;

create or replace function public.faro_cost_observatory(
  p_period text default 'today',
  p_start date default null,
  p_end date default null,
  p_surface text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  start_at timestamptz;
  end_at timestamptz;
  summary jsonb;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if p_surface is not null and p_surface not in ('lab', 'web', 'desktop', 'mobile') then raise exception 'Invalid observability surface'; end if;
  if p_period = 'today' then
    start_at := date_trunc('day', now()); end_at := start_at + interval '1 day';
  elsif p_period = 'last_7_days' then
    start_at := date_trunc('day', now()) - interval '6 days'; end_at := date_trunc('day', now()) + interval '1 day';
  elsif p_period = 'month' then
    start_at := date_trunc('month', now()); end_at := start_at + interval '1 month';
  elsif p_period = 'custom' and p_start is not null and p_end is not null and p_end >= p_start then
    start_at := p_start::timestamptz; end_at := (p_end + 1)::timestamptz;
  else
    raise exception 'Invalid observability period';
  end if;

  with rows as (
    select * from public.faro_ai_request_metrics
    where user_id = uid and created_at >= start_at and created_at < end_at
      and (p_surface is null or surface = p_surface)
  ), totals as (
    select count(*)::int as requests,
      coalesce(count(*) filter (where route = 'deterministic')::numeric / nullif(count(*), 0), 0) as deterministic_rate,
      coalesce(count(*) filter (where used_llm)::numeric / nullif(count(*), 0), 0) as llm_rate,
      coalesce(sum(input_tokens), 0)::bigint as input_tokens,
      coalesce(sum(cached_input_tokens), 0)::bigint as cached_input_tokens,
      coalesce(sum(output_tokens), 0)::bigint as output_tokens,
      coalesce(sum(estimated_cost_usd), 0) as estimated_cost_usd,
      coalesce(avg(success::int), 0) as success_rate,
      coalesce(avg(fallback::int), 0) as fallback_rate,
      percentile_cont(.5) within group (order by total_latency_ms) filter (where total_latency_ms is not null) as latency_p50_ms,
      percentile_cont(.95) within group (order by total_latency_ms) filter (where total_latency_ms is not null) as latency_p95_ms,
      coalesce(sum(estimated_cost_usd) / nullif(count(*) filter (where success), 0), 0) as cost_per_success_usd
    from rows
  )
  select jsonb_build_object(
    'periodStart', start_at,
    'periodEnd', end_at,
    'totals', (select to_jsonb(totals) from totals),
    'bySkill', coalesce((select jsonb_agg(to_jsonb(x) order by x.skill) from (
      select skill, count(*)::int as requests, coalesce(sum(estimated_cost_usd),0) as estimated_cost_usd,
        coalesce(avg(success::int),0) as success_rate from rows group by skill
    ) x), '[]'::jsonb),
    'byRoute', coalesce((select jsonb_agg(to_jsonb(x) order by x.route) from (
      select route, count(*)::int as requests, coalesce(sum(estimated_cost_usd),0) as estimated_cost_usd,
        coalesce(avg(used_llm::int),0) as llm_rate from rows group by route
    ) x), '[]'::jsonb),
    'byProviderModel', coalesce((select jsonb_agg(to_jsonb(x) order by x.provider, x.model) from (
      select coalesce(provider, 'none') as provider, coalesce(model, 'none') as model, count(*)::int as requests,
        coalesce(sum(input_tokens),0)::bigint as input_tokens, coalesce(sum(output_tokens),0)::bigint as output_tokens,
        coalesce(sum(estimated_cost_usd),0) as estimated_cost_usd from rows group by provider, model
    ) x), '[]'::jsonb),
    'byPipeline', coalesce((select jsonb_agg(to_jsonb(x) order by x.pipeline) from (
      select pipeline, count(*)::int as requests, coalesce(sum(estimated_cost_usd),0) as estimated_cost_usd,
        coalesce(avg(used_llm::int),0) as llm_rate,
        percentile_cont(.5) within group (order by total_latency_ms) filter (where total_latency_ms is not null) as latency_p50_ms,
        percentile_cont(.95) within group (order by total_latency_ms) filter (where total_latency_ms is not null) as latency_p95_ms
      from rows group by pipeline
    ) x), '[]'::jsonb)
  ) into summary;
  return summary;
end;
$$;

create or replace function public.faro_benchmark_comparison(
  p_start timestamptz default now() - interval '30 days'
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.benchmark_scenario, x.pipeline), '[]'::jsonb)
  from (
    select benchmark_scenario, pipeline, skill, route, count(*)::int as requests,
      coalesce(avg(used_llm::int),0) as llm_rate,
      coalesce(sum(input_tokens),0)::bigint as input_tokens,
      coalesce(sum(output_tokens),0)::bigint as output_tokens,
      coalesce(sum(estimated_cost_usd),0) as estimated_cost_usd,
      coalesce(avg(success::int),0) as success_rate,
      percentile_cont(.5) within group (order by total_latency_ms) filter (where total_latency_ms is not null) as latency_p50_ms,
      percentile_cont(.95) within group (order by total_latency_ms) filter (where total_latency_ms is not null) as latency_p95_ms
    from public.faro_ai_request_metrics
    where user_id = (select auth.uid()) and benchmark_scenario is not null and created_at >= p_start
    group by benchmark_scenario, pipeline, skill, route
  ) x;
$$;

revoke all on function public.faro_cost_observatory(text,date,date,text) from public;
revoke all on function public.faro_benchmark_comparison(timestamptz) from public;
grant execute on function public.faro_cost_observatory(text,date,date,text) to authenticated;
grant execute on function public.faro_benchmark_comparison(timestamptz) to authenticated;
notify pgrst, 'reload schema';
