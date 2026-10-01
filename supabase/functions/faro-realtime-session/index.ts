import { corsHeaders } from '../_shared/http.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { upsertFaroRequestMetric } from '../_shared/voice/observability/requestMetric.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const auth = request.headers.get('Authorization')
  if (!auth) return new Response('Sesión requerida.', { status: 401, headers: corsHeaders })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  })
  const { data: { user } } = await db.auth.getUser()
  if (!user) return new Response('Sesión inválida.', { status: 401, headers: corsHeaders })
  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openaiKey) return new Response('Falta configurar OPENAI_API_KEY en Supabase.', { status: 503, headers: corsHeaders })

  const requestId = crypto.randomUUID()
  const startedAt = performance.now()
  const model = Deno.env.get('OPENAI_REALTIME_MODEL') ?? 'gpt-realtime'
  const sdp = await request.text()
  const form = new FormData()
  form.set('sdp', sdp)
  form.set('session', JSON.stringify({
    type: 'realtime',
    model,
    instructions: `Transcribe únicamente habla humana claramente audible en español de México. No inventes palabras a partir de chasquidos, tonos, notificaciones, golpes ni ruido ambiente. Si no hay habla inteligible, devuelve una transcripción vacía. Esta sesión no debe generar respuestas ni voz. Identificador seguro del usuario: ${user.id}.`,
    output_modalities: ['text'],
    audio: {
      input: {
        transcription: { model: Deno.env.get('OPENAI_TRANSCRIBE_MODEL') ?? 'gpt-4o-mini-transcribe', language: 'es', prompt: 'Habla humana claramente audible en español de México. FARO es el nombre propio del asistente y su palabra de activación; transcríbelo exactamente como “FARO”. Omite sonidos del sistema, clics, golpes, tonos, notificaciones y ruido ambiente.' },
        // Keep enough trailing silence for a natural multi-word command but
        // return the final transcript promptly. 1.1 s made FARO feel as if
        // it were still thinking after the user had already finished talking.
        turn_detection: { type: 'server_vad', create_response: false, interrupt_response: false, threshold: 0.32, prefix_padding_ms: 800, silence_duration_ms: 650 },
      },
    },
  }))
  let response: Response
  try {
    response = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST', headers: { Authorization: `Bearer ${openaiKey}` }, body: form,
    })
  } catch (error) {
    await recordRealtimeMetric(db, user.id, requestId, model, performance.now() - startedAt, false)
    throw error
  }
  await recordRealtimeMetric(db, user.id, requestId, model, performance.now() - startedAt, response.ok)
  return new Response(await response.text(), {
    status: response.status,
    headers: { ...corsHeaders, 'Content-Type': response.headers.get('Content-Type') ?? 'application/sdp' },
  })
})

async function recordRealtimeMetric(fallbackDb: ReturnType<typeof createClient>, userId: string, requestId: string, model: string, elapsedMs: number, success: boolean) {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const url = Deno.env.get('SUPABASE_URL')
  const db = serviceKey && url ? createClient(url, serviceKey) : fallbackDb
  try {
    await upsertFaroRequestMetric(db, userId, {
      requestId, sessionId: null, source: 'voice', surface: 'web', pipeline: 'optimized',
      decision: {
        skill: 'unknown', intent: 'realtime_transcription', route: 'reasoning_model', confidence: 1,
        provider: 'openai', model, reason: 'realtime_audio_session',
        tierRequested: 'premium', tierUsed: 'premium', escalated: false, fallbackReason: null,
      },
    }, {
      skill: 'unknown', parsed_intent: 'realtime_transcription',
      status: success ? 'completed' : 'error', execution_status: success ? 'completed' : 'failed',
      error_message: success ? undefined : 'realtime_request_failed',
      timings: { totalLatencyMs: Math.round(elapsedMs * 100) / 100 },
      provider_metadata: { provider: 'openai', model },
    })
  } catch (error) {
    console.error('FARO realtime observability metric could not be persisted.', { name: error instanceof Error ? error.name : 'UnknownError' })
  }
}
