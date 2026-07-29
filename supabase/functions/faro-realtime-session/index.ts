import { corsHeaders } from '../_shared/http.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

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

  const sdp = await request.text()
  const form = new FormData()
  form.set('sdp', sdp)
  form.set('session', JSON.stringify({
    type: 'realtime',
    model: Deno.env.get('OPENAI_REALTIME_MODEL') ?? 'gpt-realtime',
    instructions: `Eres FARO, un asistente personal breve, sobrio y claro. Responde en español. Nunca afirmes que guardaste datos: las escrituras se confirman en la interfaz de FARO. Identificador seguro del usuario: ${user.id}.`,
    audio: {
      input: { transcription: { model: 'gpt-4o-mini-transcribe', language: 'es' } },
      output: { voice: 'marin' },
    },
  }))
  const response = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: form,
  })
  return new Response(await response.text(), {
    status: response.status,
    headers: { ...corsHeaders, 'Content-Type': response.headers.get('Content-Type') ?? 'application/sdp' },
  })
})
