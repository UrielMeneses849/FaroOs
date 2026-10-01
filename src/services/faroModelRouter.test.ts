import { afterEach, describe, expect, it, vi } from 'vitest'
import { fallbackFromDeterministic, routeFaroModel } from '../../supabase/functions/_shared/voice/routing/modelRouter'
import { estimateModelCost } from '../../supabase/functions/_shared/voice/providers/pricing'
import { createOpenAiResponsesProvider } from '../../supabase/functions/_shared/voice/providers/openAiResponsesProvider'
import { upsertFaroRequestMetric } from '../../supabase/functions/_shared/voice/observability/requestMetric'
import { AI_TIER } from '../../supabase/functions/_shared/ai/config'
import { routeFaroAI, simulateFaroAIRouting } from '../../supabase/functions/_shared/ai/router'

afterEach(() => vi.unstubAllGlobals())

describe('FARO Model Router v1', () => {
  it('elige deterministic para una escritura financiera clara', () => {
    expect(routeFaroModel({ transcript: 'Gasté 350 en comida.', surface: 'finances' })).toMatchObject({
      skill: 'finance', intent: 'create_expense', route: 'deterministic', confidence: .96, provider: null, model: null,
    })
  })

  it('elige cheap_model para una corrección contextual sin usar un LLM para enrutar', () => {
    expect(routeFaroModel({ transcript: 'Lo de gasolina de ayer realmente fueron 720.', surface: 'finances', skillHint: 'finance' })).toMatchObject({
      skill: 'finance', route: 'cheap_model', reason: expect.stringContaining('contextual_correction'),
    })
  })

  it('elige smart_model para ambigüedad de varias entidades', () => {
    expect(routeFaroModel({ transcript: 'Muéstrame todas las opciones entre mis cuentas.', surface: 'dashboard' })).toMatchObject({
      route: 'smart_model', reason: 'multi_entity_or_ambiguous_query',
    })
  })

  it('envía Backlog por la misma ruta deterministic productiva', () => {
    expect(routeFaroModel({ transcript: '¿Qué tengo pendiente de BIMSA?', surface: 'dashboard' })).toMatchObject({
      skill: 'backlog', intent: 'list_tasks_by_workspace', route: 'deterministic', provider: null, model: null,
    })
    expect(routeFaroModel({ transcript: 'Crea una tarea de BIMSA para revisar ETL.', surface: 'dashboard' })).toMatchObject({
      skill: 'backlog', intent: 'create_backlog_task', route: 'deterministic',
    })
  })

  it('resuelve la selección conversacional de Backlog sin volver al LLM', () => {
    expect(routeFaroModel({ transcript: 'La segunda.', surface: 'dashboard', skillHint: 'backlog', shortContext: { lastSkill: 'backlog', pendingClarification: { intent: 'schedule_backlog_task' } } })).toMatchObject({
      skill: 'backlog', route: 'deterministic', reason: 'backlog_context_continuation',
    })
  })

  it('conserva Calendar ante vocabulario de agenda aunque el hint previo sea Finance', () => {
    expect(routeFaroModel({ transcript: 'Organiza mi agenda pensando en todo.', surface: 'today', skillHint: 'finance' })).toMatchObject({
      skill: 'calendar',
    })
  })

  it('reserva reasoning_model para razonamiento explícito', () => {
    expect(routeFaroModel({ transcript: 'Analiza mis gastos y dime qué está afectando mi presupuesto.', surface: 'finances' })).toMatchObject({
      route: 'reasoning_model', reason: 'explicit_reasoning_request',
    })
  })

  it('mantiene unknown como única skill fuera del registro permitido', () => {
    expect(routeFaroModel({ transcript: 'Haz lo de ayer, por favor.', surface: 'today' })).toMatchObject({ skill: 'unknown', intent: 'unknown' })
  })

  it('degrada una resolución deterministic incompleta a cheap_model con razón explícita', () => {
    const initial = routeFaroModel({ transcript: 'Gasté 350 en comida.', surface: 'finances' })
    expect(fallbackFromDeterministic(initial)).toMatchObject({ route: 'cheap_model', reason: expect.stringContaining('needs_contextual_extraction') })
  })
})

describe('FARO shared AI router', () => {
  const premium: Array<{ id: string; model: string; tier: 'premium' }> = [{ id: 'openai', model: 'gpt-5-mini', tier: 'premium' }]

  it('does not require a provider for a deterministic request', () => {
    expect(routeFaroAI({ feature: 'create_expense', module: 'finance', intent: 'create_expense', preferredTier: AI_TIER.DETERMINISTIC, providers: premium })).toMatchObject({
      tierRequested: 'deterministic', tierUsed: 'deterministic', provider: null, escalated: false,
    })
  })

  it('uses the configured provider without reporting a false premium escalation', () => {
    expect(routeFaroAI({ feature: 'entity_extraction', module: 'finance', intent: 'create_expense', providers: premium })).toMatchObject({
      tierRequested: 'cheap', tierUsed: 'premium', provider: 'openai', escalated: false, fallbackReason: 'requested_tier_not_configured',
    })
  })

  it('can simulate routing without executing a provider request', () => {
    expect(simulateFaroAIRouting({ feature: 'financial_analysis', module: 'finance', intent: 'financial_analysis', providers: premium })).toMatchObject({
      tierRequested: 'standard', tierUsed: 'premium', provider: 'openai', fallbackReason: 'requested_tier_not_configured',
    })
  })
})

describe('FARO cost registry', () => {
  it('calcula el costo desde un único registro de precios', () => {
    expect(estimateModelCost('openai', 'gpt-5-mini', { inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 100_000 })).toEqual({ estimatedCostUsd: .405, costIsEstimated: false })
  })

  it('no inventa costo cuando el modelo no tiene precios verificables', () => {
    expect(estimateModelCost('openai', 'not-configured', { inputTokens: 200, outputTokens: 100 })).toEqual({ estimatedCostUsd: null, costIsEstimated: true })
  })

  it('no inventa costo si el proveedor omitió el uso de tokens', () => {
    expect(estimateModelCost('openai', 'gpt-5-mini', {})).toEqual({ estimatedCostUsd: null, costIsEstimated: true })
  })

  it('calcula cero para una ruta sin proveedor', () => {
    expect(estimateModelCost(null, null, {})).toEqual({ estimatedCostUsd: 0, costIsEstimated: false })
  })
})

describe('FARO provider and observability boundary', () => {
  it('mantiene OpenAI detrás de FaroModelProvider y normaliza usage', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output: [], output_text: 'ok', usage: { input_tokens: 12, output_tokens: 4, input_tokens_details: { cached_tokens: 2 } } }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const provider = createOpenAiResponsesProvider('secret', 'gpt-5-mini')
    const result = await provider.runStructured({ instructions: 'x', input: [{ role: 'user', content: 'hola' }], tools: [] })
    expect(provider).toMatchObject({ id: 'openai', model: 'gpt-5-mini' })
    expect(result.usage).toEqual({ inputTokens: 12, cachedInputTokens: 2, outputTokens: 4 })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('hace upsert idempotente de metadata operacional sin transcript ni argumentos', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const db = { from: () => ({ upsert }) }
    const decision = routeFaroModel({ transcript: 'Gasté 350 en comida.', surface: 'finances' })
    await upsertFaroRequestMetric(db, 'user-1', { requestId: 'request-1', sessionId: null, source: 'text', surface: 'finances', pipeline: 'optimized', decision }, { status: 'completed', skill: 'finance', timings: { routingMs: 2 } })
    await upsertFaroRequestMetric(db, 'user-1', { requestId: 'request-1', sessionId: null, source: 'text', surface: 'finances', pipeline: 'optimized', decision }, { status: 'completed', skill: 'finance', timings: { routingMs: 2 } })
    expect(upsert).toHaveBeenCalledTimes(2)
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'user_id,request_id' })
    expect(upsert.mock.calls[0][0]).not.toHaveProperty('transcript')
    expect(upsert.mock.calls[0][0]).not.toHaveProperty('tool_arguments')
  })
})
