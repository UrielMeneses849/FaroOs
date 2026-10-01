import { supabase } from '../lib/supabase/client'

export type FaroObservabilityPeriod = 'today' | 'last_7_days' | 'month' | 'custom'
export type FaroObservabilitySurface = 'all' | 'lab' | 'web' | 'desktop' | 'mobile'
export type FaroCostTotals = {
  requests: number
  deterministic_rate: number
  llm_rate: number
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  estimated_cost_usd: number
  success_rate: number
  fallback_rate: number
  latency_p50_ms: number | null
  latency_p95_ms: number | null
  cost_per_success_usd: number
}
export type FaroCostObservatory = {
  periodStart: string
  periodEnd: string
  totals: FaroCostTotals
  bySkill: Array<{ skill: string; requests: number; estimated_cost_usd: number; success_rate: number }>
  byRoute: Array<{ route: string; requests: number; estimated_cost_usd: number; llm_rate: number }>
  byProviderModel: Array<{ provider: string; model: string; requests: number; input_tokens: number; output_tokens: number; estimated_cost_usd: number }>
  byPipeline: Array<{ pipeline: string; requests: number; estimated_cost_usd: number; llm_rate: number; latency_p50_ms: number | null; latency_p95_ms: number | null }>
}

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
const rpc = supabase.rpc.bind(supabase) as unknown as Rpc

function observatoryFrom(value: unknown): FaroCostObservatory {
  if (!value || typeof value !== 'object') throw new Error('FARO no devolvió métricas de observabilidad válidas.')
  return value as FaroCostObservatory
}

export const faroCostObservatoryService = {
  async load(period: FaroObservabilityPeriod = 'today', range?: { start: string; end: string }, surface: FaroObservabilitySurface = 'all') {
    const { data, error } = await rpc('faro_cost_observatory', { p_period: period, p_start: range?.start, p_end: range?.end, p_surface: surface === 'all' ? undefined : surface })
    if (error) throw new Error(error.message)
    return observatoryFrom(data)
  },
  async benchmarkComparison() {
    const { data, error } = await rpc('faro_benchmark_comparison')
    if (error) throw new Error(error.message)
    return Array.isArray(data) ? data : []
  },
}
