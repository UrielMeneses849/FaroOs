import type { FaroRouteDecision } from '../routing/modelRouter.ts'
import { estimateModelCost, type FaroTokenUsage } from '../providers/pricing.ts'
import { AI_TIER, tierForLegacyRoute, type AITier } from '../../ai/config.ts'

type Db = { from: (table: string) => any }

type MetricMeta = {
  requestId: string
  sessionId: string | null
  source: string
  surface: string
  pipeline: 'legacy' | 'optimized'
  benchmarkScenario?: string
  decision?: FaroRouteDecision
}

function numberOrNull(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : null }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function tierOr(value: unknown, fallback: AITier) {
  return value === AI_TIER.DETERMINISTIC || value === AI_TIER.CHEAP || value === AI_TIER.STANDARD || value === AI_TIER.PREMIUM ? value : fallback
}

/** Persists operational metadata only; transcript and tool arguments are intentionally absent. */
export async function upsertFaroRequestMetric(db: Db, userId: string, meta: MetricMeta, values: Record<string, unknown>) {
  const decision = meta.decision
  if (!decision) return
  const timings = record(values.timings)
  const provider = record(values.provider_metadata)
  const routing = record(provider.routing)
  const usage = provider.usage as FaroTokenUsage | undefined
  const providerId = typeof provider.provider === 'string' ? provider.provider : decision.provider
  const model = typeof provider.model === 'string' ? provider.model : decision.model
  const tierRequested = tierOr(routing.tierRequested ?? decision.tierRequested, tierForLegacyRoute(decision.route))
  const tierUsed = tierOr(routing.tierUsed ?? decision.tierUsed, tierRequested)
  const rawCost = estimateModelCost(providerId, model, usage ?? {})
  // Zero is reserved for deterministic work. A model route without a provider
  // means the request never reached an adapter, not that it was free.
  const cost = tierUsed !== AI_TIER.DETERMINISTIC && !providerId
    ? { estimatedCostUsd: null, costIsEstimated: true }
    : rawCost
  const costStatus = tierUsed === AI_TIER.DETERMINISTIC ? 'not_applicable' : cost.estimatedCostUsd === null ? 'unknown' : 'known'
  const metric = {
    user_id: userId,
    request_id: meta.requestId,
    session_id: meta.sessionId,
    source: meta.source,
    surface: meta.surface,
    pipeline: meta.pipeline,
    benchmark_scenario: meta.benchmarkScenario ?? null,
    skill: typeof values.skill === 'string' ? values.skill : decision.skill,
    intent: typeof values.parsed_intent === 'string' ? values.parsed_intent : decision.intent,
    module: typeof values.module === 'string' ? values.module : typeof values.skill === 'string' ? values.skill : decision.skill,
    feature: typeof routing.feature === 'string' ? routing.feature : typeof values.parsed_intent === 'string' ? values.parsed_intent : decision.intent,
    route: decision.route,
    route_reason: decision.reason,
    confidence: decision.confidence,
    provider: providerId,
    model,
    tier_requested: tierRequested,
    tier_used: tierUsed,
    used_llm: values.used_llm === false ? false : tierUsed !== AI_TIER.DETERMINISTIC && Boolean(providerId),
    input_tokens: usage?.inputTokens ?? null,
    cached_input_tokens: usage?.cachedInputTokens ?? null,
    output_tokens: usage?.outputTokens ?? null,
    stt_provider: typeof provider.sttProvider === 'string' ? provider.sttProvider : null,
    stt_latency_ms: numberOrNull(timings.sttFinalMs),
    routing_latency_ms: numberOrNull(timings.routingMs ?? timings.modelRoutingMs),
    context_latency_ms: numberOrNull(timings.contextMs),
    llm_latency_ms: numberOrNull(timings.llmMs),
    tool_latency_ms: numberOrNull(timings.executionMs),
    tts_provider: typeof provider.ttsProvider === 'string' ? provider.ttsProvider : typeof provider.ttsModel === 'string' ? 'elevenlabs' : null,
    tts_latency_ms: numberOrNull(timings.ttsTotalMs),
    total_latency_ms: numberOrNull(timings.endToEndMs ?? timings.serverTotalMs ?? timings.totalLatencyMs),
    success: values.status !== 'error' && values.execution_status !== 'failed',
    error_code: typeof values.error_message === 'string' ? 'request_error' : null,
    error_type: typeof values.error_message === 'string' ? 'request_error' : null,
    fallback: Boolean(routing.fallbackReason ?? decision.fallbackReason),
    fallback_reason: typeof (routing.fallbackReason ?? decision.fallbackReason) === 'string' ? routing.fallbackReason ?? decision.fallbackReason : null,
    escalated: Boolean(routing.escalated ?? decision.escalated),
    avoided_llm_call: tierUsed === AI_TIER.DETERMINISTIC,
    estimated_cost_usd: cost.estimatedCostUsd,
    cost_is_estimated: cost.costIsEstimated,
    cost_status: costStatus,
  }
  const { error } = await db.from('faro_ai_request_metrics').upsert(metric, { onConflict: 'user_id,request_id' })
  if (error) throw error
}
