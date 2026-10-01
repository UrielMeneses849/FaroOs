import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { upsertFaroRequestMetric } from '../_shared/voice/observability/requestMetric.ts'

const MAX_TEXT_LENGTH = 600
const safeProviderBody = (value: unknown): unknown => {
  if (typeof value === 'string') return value.slice(0, 2000)
  if (Array.isArray(value)) return value.slice(0, 20).map(safeProviderBody)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 30).map(([key, item]) => [key, /key|token|authorization|secret/i.test(key) ? '[REDACTED]' : safeProviderBody(item)]))
  return value
}
const providerField = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : null

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed', message: 'Método no permitido.' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'unauthorized', message: 'Sesión requerida.' }, 401)
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
    })
    const { data: { user } } = await db.auth.getUser()
    if (!user) return json({ error: 'unauthorized', message: 'Sesión inválida.' }, 401)

    const apiKey = Deno.env.get('ELEVENLABS_API_KEY')
    const voiceId = Deno.env.get('ELEVENLABS_VOICE_ID')
    const modelId = Deno.env.get('ELEVENLABS_MODEL_ID')
    if (!apiKey || !voiceId || !modelId) return json({ error: 'speech_not_configured', message: 'La voz de FARO no está configurada.' }, 503)

    const body = await request.json().catch(() => null) as { type?: unknown; text?: unknown; model?: unknown; stream?: unknown } | null
    if (body?.type === 'health') return json({ status: 'ready' })
    const text = typeof body?.text === 'string' ? body.text.trim().replace(/\s+/g, ' ') : ''
    if (!text) return json({ error: 'invalid_text', message: 'El texto es requerido.' }, 400)
    if (text.length > MAX_TEXT_LENGTH) return json({ error: 'text_too_long', message: `El texto no puede superar ${MAX_TEXT_LENGTH} caracteres.` }, 413)

    const requestedModel = body?.model === 'flash' ? 'flash' : 'current'
    const selectedModel = requestedModel === 'flash' ? 'eleven_flash_v2_5' : modelId
    const stream = body?.stream !== false
    const requestId = crypto.randomUUID()
    const providerStartedAt = performance.now()
    let provider: Response
    try {
      provider = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}${stream ? '/stream' : ''}?output_format=mp3_44100_128${stream ? '&optimize_streaming_latency=2' : ''}`, {
        method: 'POST', headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: selectedModel }),
      })
    } catch (error) {
      await recordSpeechMetric(db, user.id, requestId, selectedModel, performance.now() - providerStartedAt, false)
      throw error
    }
    if (!provider.ok || !provider.body) {
      await recordSpeechMetric(db, user.id, requestId, selectedModel, performance.now() - providerStartedAt, false)
      const contentType = provider.headers.get('Content-Type')?.toLowerCase() ?? ''
      let providerBody: unknown
      try { providerBody = contentType.includes('application/json') ? await provider.json() : await provider.text() }
      catch { providerBody = null }
      const bodyRecord = providerBody && typeof providerBody === 'object' ? providerBody as Record<string, unknown> : {}
      const detail = bodyRecord.detail && typeof bodyRecord.detail === 'object' ? bodyRecord.detail as Record<string, unknown> : {}
      const providerCode = providerField(detail.status) ?? providerField(bodyRecord.code) ?? providerField(bodyRecord.error)
      const providerMessage = providerField(detail.message) ?? providerField(bodyRecord.message) ?? (typeof providerBody === 'string' && providerBody.trim() ? providerBody.slice(0, 500) : 'ElevenLabs rechazó la solicitud.')
      console.error({
        provider: 'elevenlabs', providerStatus: provider.status, providerStatusText: provider.statusText,
        providerBody: safeProviderBody(providerBody), voiceIdPresent: Boolean(voiceId), modelId: selectedModel, textLength: text.length,
      })
      return json({ error: 'speech_provider_failed', providerStatus: provider.status, providerCode, providerMessage }, provider.status)
    }

    await recordSpeechMetric(db, user.id, requestId, selectedModel, performance.now() - providerStartedAt, true)

    return new Response(provider.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': provider.headers.get('Content-Type') ?? 'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-FARO-Model-Id': selectedModel,
        'X-FARO-Provider-Headers-Ms': String(Math.round((performance.now() - providerStartedAt) * 100) / 100),
        'Access-Control-Expose-Headers': 'X-FARO-Model-Id,X-FARO-Provider-Headers-Ms',
      },
    })
  } catch (error) {
    console.error('faro-speech failed', { name: error instanceof Error ? error.name : 'UnknownError' })
    return json({ error: 'speech_failed', message: 'No fue posible generar la voz de FARO.' }, 500)
  }
})

async function recordSpeechMetric(fallbackDb: ReturnType<typeof createClient>, userId: string, requestId: string, model: string, elapsedMs: number, success: boolean) {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const url = Deno.env.get('SUPABASE_URL')
  const db = serviceKey && url ? createClient(url, serviceKey) : fallbackDb
  try {
    await upsertFaroRequestMetric(db, userId, {
      requestId, sessionId: null, source: 'voice', surface: 'web', pipeline: 'optimized',
      decision: {
        skill: 'unknown', intent: 'speech_synthesis', route: 'reasoning_model', confidence: 1,
        provider: 'elevenlabs', model, reason: 'speech_provider',
        tierRequested: 'premium', tierUsed: 'premium', escalated: false, fallbackReason: null,
      },
    }, {
      module: 'assistant', skill: 'unknown', parsed_intent: 'speech_synthesis', used_llm: false,
      status: success ? 'completed' : 'error', execution_status: success ? 'completed' : 'failed',
      error_message: success ? undefined : 'speech_provider_failed',
      timings: { totalLatencyMs: Math.round(elapsedMs * 100) / 100 },
      provider_metadata: { provider: 'elevenlabs', model, ttsProvider: 'elevenlabs' },
    })
  } catch (error) {
    console.error('FARO speech observability metric could not be persisted.', { name: error instanceof Error ? error.name : 'UnknownError' })
  }
}
