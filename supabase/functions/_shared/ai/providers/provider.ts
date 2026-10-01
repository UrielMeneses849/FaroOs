export type FaroStructuredRequest = {
  instructions: string
  input: Array<{ role: 'user' | 'assistant'; content: string }>
  tools: unknown[]
}

export type FaroProviderUsage = {
  inputTokens: number | null
  cachedInputTokens: number | null
  outputTokens: number | null
}

export type FaroProviderResult = {
  output: any[]
  outputText: string
  usage: FaroProviderUsage
  raw: unknown
}

/** Provider contract shared by every text/reasoning model adapter. */
export interface FaroModelProvider {
  readonly id: string
  readonly model: string
  runStructured(request: FaroStructuredRequest): Promise<FaroProviderResult>
  runReasoning(request: FaroStructuredRequest): Promise<FaroProviderResult>
}
