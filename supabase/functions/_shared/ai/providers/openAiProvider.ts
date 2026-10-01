import type { FaroModelProvider, FaroProviderResult, FaroStructuredRequest } from './provider.ts'

type OpenAiResponse = {
  output?: any[]
  output_text?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    input_tokens_details?: { cached_tokens?: number }
  }
}

/**
 * The current FARO OpenAI integration behind the provider boundary. Nothing
 * outside a provider adapter needs to know the OpenAI Responses wire format.
 */
export function createOpenAIProvider(apiKey: string, model = 'gpt-5-mini'): FaroModelProvider {
  async function run(request: FaroStructuredRequest): Promise<FaroProviderResult> {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, instructions: request.instructions, input: request.input, tools: request.tools, tool_choice: 'auto' }),
    })
    if (!response.ok) throw new Error(`OpenAI respondió ${response.status}: ${await response.text()}`)
    const raw = await response.json() as OpenAiResponse
    return {
      output: raw.output ?? [],
      outputText: raw.output_text ?? '',
      raw,
      usage: {
        inputTokens: raw.usage?.input_tokens ?? null,
        cachedInputTokens: raw.usage?.input_tokens_details?.cached_tokens ?? null,
        outputTokens: raw.usage?.output_tokens ?? null,
      },
    }
  }

  return { id: 'openai', model, runStructured: run, runReasoning: run }
}
