import { AI_ROUTING_CONFIG, AI_TIER, type AITier } from './config.ts'

export type AIProviderTarget = { id: string; model: string; tier: Exclude<AITier, 'deterministic'> }

export type FaroAIRequest = {
  feature: string
  module: string
  intent: string
  preferredTier?: AITier
  confidence?: number
  providers: AIProviderTarget[]
}

export type FaroAIRoutingDecision = {
  feature: string
  module: string
  intent: string
  tierRequested: AITier
  tierUsed: AITier
  provider: string | null
  model: string | null
  reason: string
  confidence: number | null
  escalated: boolean
  fallbackReason: string | null
}

function requestedTier(request: FaroAIRequest): AITier {
  return request.preferredTier
    ?? AI_ROUTING_CONFIG.features[request.feature]
    ?? AI_ROUTING_CONFIG.defaultTier
}

/** Pure routing/simulation function: it never contacts a provider. */
export function routeFaroAI(request: FaroAIRequest): FaroAIRoutingDecision {
  const tierRequested = requestedTier(request)
  if (tierRequested === AI_TIER.DETERMINISTIC) {
    return {
      feature: request.feature, module: request.module, intent: request.intent,
      tierRequested, tierUsed: AI_TIER.DETERMINISTIC,
      provider: null, model: null, reason: 'deterministic_handler',
      confidence: request.confidence ?? null, escalated: false, fallbackReason: null,
    }
  }

  const exact = request.providers.find((provider) => provider.tier === tierRequested)
  if (exact) {
    return {
      feature: request.feature, module: request.module, intent: request.intent,
      tierRequested, tierUsed: exact.tier, provider: exact.id, model: exact.model,
      reason: 'configured_provider', confidence: request.confidence ?? null,
      escalated: false, fallbackReason: null,
    }
  }

  // Retain functionality through the configured provider without relabelling a
  // lower-tier request as Premium. This makes telemetry match the actual policy
  // and prevents an accidental premium-rate spike when only one adapter exists.
  const configured = request.providers[0]
  if (configured) {
    return {
      feature: request.feature, module: request.module, intent: request.intent,
      tierRequested, tierUsed: configured.tier, provider: configured.id, model: configured.model,
      reason: 'provider_fallback', confidence: request.confidence ?? null,
      escalated: false, fallbackReason: 'requested_tier_not_configured',
    }
  }

  // Backwards-compatible fallback for a dedicated premium adapter.
  const premium = request.providers.find((provider) => provider.tier === AI_TIER.PREMIUM)
  if (premium) {
    return {
      feature: request.feature, module: request.module, intent: request.intent,
      tierRequested, tierUsed: AI_TIER.PREMIUM,
      provider: premium.id, model: premium.model,
      reason: 'provider_fallback', confidence: request.confidence ?? null,
      escalated: tierRequested !== AI_TIER.PREMIUM,
      fallbackReason: 'provider_not_configured',
    }
  }

  return {
    feature: request.feature, module: request.module, intent: request.intent,
    tierRequested, tierUsed: tierRequested, provider: null, model: null,
    reason: 'provider_unavailable', confidence: request.confidence ?? null,
    escalated: false, fallbackReason: 'provider_not_configured',
  }
}

/** Alias kept intentionally obvious for future Nova routing dry-runs. */
export const simulateFaroAIRouting = routeFaroAI
