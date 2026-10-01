/**
 * Central routing policy for FARO AI. This file contains policy only: it does
 * not contain credentials nor create provider clients.
 */
export const AI_TIER = {
  DETERMINISTIC: 'deterministic',
  CHEAP: 'cheap',
  STANDARD: 'standard',
  PREMIUM: 'premium',
} as const

export type AITier = typeof AI_TIER[keyof typeof AI_TIER]

export const FINOPS_TIER_GOALS: Record<AITier, { label: string; target: string }> = {
  [AI_TIER.DETERMINISTIC]: { label: 'Tier 0 · Deterministic', target: '>= 50%' },
  [AI_TIER.CHEAP]: { label: 'Tier 1 · Cheap', target: '>= 35%' },
  [AI_TIER.STANDARD]: { label: 'Tier 2 · Standard', target: '<= 12%' },
  [AI_TIER.PREMIUM]: { label: 'Tier 3 · Premium', target: '<= 3%' },
}

/**
 * Feature defaults are intentionally declarative. A feature may still request
 * a higher tier explicitly when its own deterministic confidence is low.
 */
export const AI_ROUTING_CONFIG = {
  defaultTier: AI_TIER.STANDARD,
  features: {
    intent_classification: AI_TIER.CHEAP,
    entity_extraction: AI_TIER.CHEAP,
    voice_action_extraction: AI_TIER.CHEAP,
    voice_action_resolution: AI_TIER.STANDARD,
    // FARO Voice starts on the economical configured model. Premium is an
    // explicit escalation path, never the default for ordinary conversation.
    financial_analysis: AI_TIER.STANDARD,
    conversational_reasoning: AI_TIER.STANDARD,
  } as Record<string, AITier>,
  // OpenAI is the only configured provider today. Add a Cheap/Standard target
  // here once its credentials and adapter are actually available.
  providerOrder: [AI_TIER.CHEAP, AI_TIER.STANDARD, AI_TIER.PREMIUM] as AITier[],
} as const

export function tierForLegacyRoute(route: 'deterministic' | 'cheap_model' | 'smart_model' | 'reasoning_model'): AITier {
  if (route === 'deterministic') return AI_TIER.DETERMINISTIC
  if (route === 'cheap_model') return AI_TIER.CHEAP
  if (route === 'smart_model') return AI_TIER.STANDARD
  return AI_TIER.PREMIUM
}
