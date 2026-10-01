import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('Faltan variables públicas de Supabase.')

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
const auth = await client.auth.signInAnonymously({ options: { data: { faro_mode: 'ai_test_lab' } } })
if (auth.error || !auth.data.session) throw auth.error ?? new Error('No se creó la sesión Lab.')

const headers = { Authorization: `Bearer ${auth.data.session.access_token}`, apikey: key, 'Content-Type': 'application/json' }
const sessionId = crypto.randomUUID()
const localContext = { now: '2026-08-09T01:00:00.000Z', calendarItems: [] }
const edge = async (body) => {
  const response = await fetch(`${url}/functions/v1/faro-voice`, { method: 'POST', headers, body: JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(`${response.status}: ${data.message}`)
  return data
}
const say = (message) => edge({ requestId: crypto.randomUUID(), sessionId, source: 'text', message, history: [], surface: 'lab', pipeline: 'optimized', localContext, sessionContext: { sessionId, lastSkill: 'calendar', lastResults: [] } })

const requestId = crypto.randomUUID()
const data = await edge({
  requestId,
  sessionId,
  source: 'text',
  message: 'Registra un evento el día 12 de agosto de 9 de la mañana a 6 de la tarde, con el título AWS Summit',
  history: [],
  surface: 'lab',
  pipeline: 'optimized',
  localContext,
})
if (data.status !== 'pending_confirmation') throw new Error(`No propuso la creación: ${data.message}`)
const args = data.pendingAction?.arguments ?? {}
if (args.timezone !== 'America/Mexico_City') throw new Error(`Zona incorrecta: ${args.timezone}`)
if (args.start !== '2026-08-12T15:00:00.000Z') throw new Error(`Inicio incorrecto: ${args.start}`)
if (args.end !== '2026-08-13T00:00:00.000Z') throw new Error(`Fin incorrecto: ${args.end}`)
if (/zona horaria|Mexico_City/i.test(data.message)) throw new Error(`Preguntó la zona horaria: ${data.message}`)

await edge({ type: 'cancel', requestId })

const creation = await say('Crea un evento llamado Prueba Move Hotfix el 13 de agosto a las 7 de la noche')
if (creation.status !== 'pending_confirmation') throw new Error(`No propuso evento para mover: ${creation.message}`)
const created = await edge({ type: 'confirm', requestId: creation.pendingAction.requestId })
const eventId = created.result?.item?.id
if (!eventId) throw new Error('La creación para prueba de movimiento no devolvió ID.')

const move = await say('Mueve mi evento de 7 de la noche a una hora después')
if (move.status !== 'pending_confirmation') throw new Error(`No propuso movimiento: ${move.message}`)
if (move.pendingAction.arguments.start !== '2026-08-14T02:00:00.000Z') throw new Error(`Movimiento incorrecto: ${move.pendingAction.arguments.start}`)
await edge({ type: 'confirm', requestId: move.pendingAction.requestId })
const persisted = await client.from('calendar_entries').select('starts_at').eq('id', eventId).single()
if (persisted.error || persisted.data.starts_at !== '2026-08-14T02:00:00+00:00') throw persisted.error ?? new Error(`Hora persistida incorrecta: ${persisted.data.starts_at}`)
await client.from('calendar_entries').delete().eq('id', eventId)
await client.auth.signOut()

console.log(JSON.stringify({
  status: data.status,
  prompt: data.message,
  title: args.title,
  timezone: args.timezone,
  start: args.start,
  end: args.end,
  persisted: false,
  movePrompt: move.message,
  movedTo: move.pendingAction.arguments.start,
  moveCleanedUp: true,
}, null, 2))
