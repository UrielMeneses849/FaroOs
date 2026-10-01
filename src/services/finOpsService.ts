import { supabase } from '../lib/supabase/client'

export type FinOpsPeriod = 'today' | 'last_7_days' | 'month'
export type FinOpsTotals = {
  requests: number
  ai_requests: number
  avoided_calls: number
  unknown_cost_requests: number
  known_cost_usd: number
  average_cost_usd: number
  average_latency_ms: number | null
  premium_rate: number
  escalations: number
  failed_requests: number
  latency_p50_ms: number | null
  latency_p95_ms: number | null
}
export type FinOpsDashboard = {
  periodStart: string
  periodEnd: string
  totals: FinOpsTotals
  tiers: Array<{ tier: string; requests: number; known_cost_usd: number; unknown_cost_requests: number; escalated_requests: number }>
  providers: Array<{ provider: string; model: string; requests: number; input_tokens: number; output_tokens: number; cached_tokens: number; known_cost_usd: number; unknown_cost_requests: number; average_latency_ms: number | null }>
  modules: Array<{ module: string; requests: number; known_cost_usd: number; unknown_cost_requests: number; predominant_tier: string }>
  features: Array<{ feature: string; requests: number; known_cost_usd: number; unknown_cost_requests: number; average_cost_usd: number; average_latency_ms: number | null; predominant_tier: string }>
  tokensOverTime: Array<{ day: string; input_tokens: number; output_tokens: number; cached_tokens: number }>
  escalations: Array<{ requested_tier: string; used_tier: string; reason: string; requests: number }>
  errors: Array<{ error_type: string; provider: string; requests: number }>
  optimizationOpportunity: { requests: number; reason: string }
  history: Array<{ created_at: string; module: string; feature: string; intent: string; tier_requested: string; tier_used: string; provider: string | null; model: string | null; input_tokens: number | null; output_tokens: number | null; cached_input_tokens: number | null; estimated_cost_usd: number | null; cost_status: 'known' | 'unknown' | 'not_applicable'; total_latency_ms: number | null; success: boolean; error_type: string | null; fallback_reason: string | null; escalated: boolean }>
  budget: { monthlyBudgetUsd: number | null; monthKnownCostUsd: number; monthUnknownCostRequests: number; percentageUsed: number | null; projectedKnownCostUsd: number }
}

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
const rpc = supabase.rpc.bind(supabase) as unknown as Rpc

function requireDashboard(value: unknown): FinOpsDashboard {
  if (!value || typeof value !== 'object') throw new Error('FARO no devolvió métricas FinOps válidas.')
  return value as FinOpsDashboard
}

export const finOpsService = {
  async dashboard(period: FinOpsPeriod = 'month') {
    const { data, error } = await rpc('faro_finops_dashboard', { p_period: period })
    if (error) throw new Error(error.message)
    return requireDashboard(data)
  },
  async saveMonthlyBudget(monthlyBudgetUsd: number) {
    const { data, error } = await rpc('faro_set_ai_budget', { p_monthly_budget_usd: monthlyBudgetUsd })
    if (error) throw new Error(error.message)
    return data
  },
}
