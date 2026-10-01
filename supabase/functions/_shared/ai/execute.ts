import { AI_TIER } from './config.ts'
import { routeFaroAI, type AIProviderTarget, type FaroAIRequest, type FaroAIRoutingDecision } from './router.ts'
import type { FaroModelProvider, FaroProviderResult, FaroStructuredRequest } from './providers/provider.ts'

export type FaroAIExecuteRequest = Omit<FaroAIRequest, 'providers'> & {
  providers: FaroModelProvider[]
  providerTargets: AIProviderTarget[]
  request: FaroStructuredRequest
  mode?: 'structured' | 'reasoning'
}

export type FaroAIExecution = {
  routing: FaroAIRoutingDecision
  provider: FaroModelProvider
  result: FaroProviderResult
}

/**
 * Single entry point for FARO text-model execution. Features declare intent
 * and desired intelligence; this layer selects the configured adapter.
 */
export async function executeFaroAI(input: FaroAIExecuteRequest): Promise<FaroAIExecution> {
  const routing = routeFaroAI({
    feature: input.feature,
    module: input.module,
    intent: input.intent,
    preferredTier: input.preferredTier,
    confidence: input.confidence,
    providers: input.providerTargets,
  })
  if (routing.tierUsed === AI_TIER.DETERMINISTIC || !routing.provider || !routing.model) {
    throw new Error('Esta solicitud no tiene un proveedor de IA configurado.')
  }
  const provider = input.providers.find((candidate) => candidate.id === routing.provider && candidate.model === routing.model)
  if (!provider) throw new Error(`El proveedor ${routing.provider}/${routing.model} no está disponible.`)
  const result = input.mode === 'reasoning'
    ? await provider.runReasoning(input.request)
    : await provider.runStructured(input.request)
  return { routing, provider, result }
}
