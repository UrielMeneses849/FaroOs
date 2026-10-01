import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('Faltan variables públicas de Supabase.')

const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
const auth = await client.auth.signInAnonymously({ options: { data: { faro_mode: 'ai_test_lab' } } })
if (auth.error || !auth.data.session) throw auth.error ?? new Error('No se creó la sesión Lab.')

const response = await fetch(`${url}/functions/v1/faro-voice`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${auth.data.session.access_token}`,
    apikey: key,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    requestId: crypto.randomUUID(),
    source: 'voice',
    message: '¿Qué hay en mi calendario de mañana?',
    surface: 'lab',
    pipeline: 'optimized',
    localContext: {
      now: '2026-08-09T01:34:00.000Z',
      timezone: 'America/Mexico_City',
      calendarItems: [{
        id: 'visible-client-task',
        kind: 'task',
        title: 'Compromiso visible en Calendar',
        start: '2026-08-09T16:30:00.000Z',
        end: '2026-08-09T18:30:00.000Z',
        allDay: false,
      }],
    },
  }),
})
const data = await response.json()
await client.auth.signOut()

if (!response.ok || data.status !== 'completed' || !data.message?.includes('Compromiso visible en Calendar')) {
  throw new Error(`Snapshot no reflejado por Voice: ${JSON.stringify(data)}`)
}
console.log(JSON.stringify({ status: data.status, message: data.message, route: data.qa?.route }, null, 2))
