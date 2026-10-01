export type FaroModelPricing = {
  provider: string
  model: string
  inputPerMillion: number | null
  cachedInputPerMillion: number | null
  outputPerMillion: number | null
  estimated: boolean
}

// One explicit registry. Update prices here when a provider price card changes.
export const MODEL_PRICING: FaroModelPricing[] = [
  { provider: 'openai', model: 'gpt-5-mini', inputPerMillion: .25, cachedInputPerMillion: .025, outputPerMillion: 2, estimated: false },
]

export type FaroTokenUsage = { inputTokens?: number | null; cachedInputTokens?: number | null; outputTokens?: number | null }
export type FaroCostEstimate = { estimatedCostUsd: number | null; costIsEstimated: boolean }

export function estimateModelCost(provider: string | null | undefined, model: string | null | undefined, usage: FaroTokenUsage): FaroCostEstimate {
  if (!provider || !model) return { estimatedCostUsd: 0, costIsEstimated: false }
  const price = MODEL_PRICING.find((entry) => entry.provider === provider && entry.model === model)
  if (!price || price.inputPerMillion === null || price.outputPerMillion === null) return { estimatedCostUsd: null, costIsEstimated: true }
  if (!Number.isFinite(usage.inputTokens) || !Number.isFinite(usage.outputTokens)) return { estimatedCostUsd: null, costIsEstimated: true }
  const input = usage.inputTokens ?? 0
  const cached = Math.min(usage.cachedInputTokens ?? 0, input)
  const output = usage.outputTokens ?? 0
  const cachePrice = price.cachedInputPerMillion ?? price.inputPerMillion
  return {
    estimatedCostUsd: ((input - cached) * price.inputPerMillion + cached * cachePrice + output * price.outputPerMillion) / 1_000_000,
    costIsEstimated: price.estimated,
  }
}
