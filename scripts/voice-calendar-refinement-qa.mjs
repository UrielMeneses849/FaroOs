import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('Faltan variables públicas de Supabase.')

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
const auth = await client.auth.signInAnonymously({ options: { data: { faro_mode: 'ai_test_lab' } } })
if (auth.error || !auth.data.session) throw auth.error ?? new Error('No se creó la sesión Lab.')
const headers = { Authorization: `Bearer ${auth.data.session.access_token}`, apikey: key, 'Content-Type': 'application/json' }
const localContext = { now: '2026-08-09T01:00:00.000Z', timezone: 'America/Mexico_City', calendarItems: [] }
const sessionId = crypto.randomUUID()
let context = { sessionId, lastSkill: 'calendar', lastResults: [] }
const cleanup = { events: [], tasks: [] }

async function edge(body) {
  const response = await fetch(`${url}/functions/v1/faro-voice`, { method: 'POST', headers, body: JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(`${response.status}: ${data.message}`)
  return data
}

async function say(message) {
  const data = await edge({ requestId: crypto.randomUUID(), sessionId, source: 'text', message, history: [], surface: 'lab', pipeline: 'optimized', localContext, sessionContext: context })
  const result = data.result && typeof data.result === 'object' ? data.result : {}
  context = { ...context, lastSkill: data.qa?.skill ?? context.lastSkill, lastResults: result.references ?? context.lastResults, pendingClarification: result.pendingClarification, pendingAction: data.pendingAction }
  return data
}

async function confirm(action) {
  const data = await edge({ type: 'confirm', requestId: action.requestId })
  if (data.status !== 'completed') throw new Error(data.message)
  if (data.result?.reference) context = { ...context, lastResults: [data.result.reference], pendingAction: undefined, pendingClarification: undefined }
  return data
}

try {
  const prepared = await client.rpc('prepare_ai_calendar_scenario', { p_anchor_date: '2026-08-08', p_confirm_is_test_user: true })
  if (prepared.error) throw prepared.error
  if (!prepared.data?.bimsaWorkspaceId) throw new Error('El escenario Lab no creó BIMSA.')

  context = { sessionId, lastSkill: 'calendar', lastResults: [] }
  const nextCommitment = await say('¿Cuál es el compromiso más próximo en mi calendario?')
  if (!nextCommitment.message.includes('mañana') || !nextCommitment.message.includes('[LAB] Reunión BIMSA')) throw new Error(`El siguiente compromiso no conservó el día relativo: ${nextCommitment.message}`)

  context = { sessionId, lastSkill: 'calendar', lastResults: [] }
  const unnamed = await say('Crea un evento en mi calendario mañana a las 8 de la noche')
  if (unnamed.status !== 'needs_clarification' || !unnamed.result?.pendingClarification?.missingFields?.includes('title')) throw new Error(`No pidió el título faltante: ${JSON.stringify(unnamed)}`)

  const list = await say('¿Qué eventos tengo mañana?')
  if (!list.message.includes('[LAB] Reunión BIMSA') || !list.message.includes('10 de la mañana')) throw new Error(`La consulta no devolvió nombre + hora: ${list.message}`)

  context = { sessionId, lastSkill: 'calendar', lastResults: [] }
  const earliest = await say('Busca el evento que tengo mañana más temprano')
  if (earliest.result?.references?.length !== 1 || earliest.result.references[0]?.title !== '[LAB] Reunión BIMSA') throw new Error(`No devolvió únicamente el evento más temprano: ${JSON.stringify(earliest.result?.references)}`)

  context = { sessionId, lastSkill: 'calendar', lastResults: [] }
  const namedMove = await say('Crea un evento el 12 de agosto de 7 de la noche a 8 de la noche con el título Prueba 1')
  const namedMoveSaved = await confirm(namedMove.pendingAction)
  const namedMoveId = namedMoveSaved.result?.item?.id
  cleanup.events.push(namedMoveId)
  context = { sessionId, lastSkill: 'calendar', lastResults: [] }
  const askMove = await say('Cambia de hora el evento llamado Prueba 1')
  if (askMove.status !== 'needs_clarification' || askMove.result?.references?.[0]?.id !== namedMoveId) throw new Error(`No encontró Prueba 1 por su nombre: ${JSON.stringify(askMove)}`)
  const earlier = await say('Recórrelo una hora antes')
  if (earlier.pendingAction?.arguments?.targetId !== namedMoveId || earlier.pendingAction?.arguments?.start !== '2026-08-13T00:00:00.000Z') throw new Error(`No resolvió el movimiento relativo: ${JSON.stringify(earlier.pendingAction?.arguments)}`)
  await confirm(earlier.pendingAction)
  context = { sessionId, lastSkill: 'calendar', lastResults: [] }
  const renamed = await say('Renombra el evento Prueba 1 a Prueba uno')
  if (renamed.pendingAction?.arguments?.targetId !== namedMoveId || renamed.pendingAction?.arguments?.title !== 'Prueba uno') throw new Error(`No preparó el renombrado exacto: ${JSON.stringify(renamed.pendingAction?.arguments)}`)
  await confirm(renamed.pendingAction)

  context = { sessionId, lastSkill: 'calendar', lastResults: [] }
  const durationTarget = await say('Crea un evento el 13 de agosto de 12 del día a la una de la tarde con el título Prueba 3')
  const durationSaved = await confirm(durationTarget.pendingAction)
  const durationId = durationSaved.result?.item?.id
  cleanup.events.push(durationId)
  context = { sessionId, lastSkill: 'calendar', lastResults: [] }
  const durationChange = await say('Cambia la duración del evento Prueba 3 a 4 horas')
  const persistedDurationStart = new Date(durationSaved.result?.item?.starts_at).toISOString()
  const expectedDurationEnd = new Date(new Date(persistedDurationStart).getTime() + 4 * 60 * 60 * 1000).toISOString()
  if (durationChange.pendingAction?.arguments?.targetId !== durationId || new Date(durationChange.pendingAction?.arguments?.start).getTime() !== new Date(persistedDurationStart).getTime() || new Date(durationChange.pendingAction?.arguments?.end).getTime() !== new Date(expectedDurationEnd).getTime()) throw new Error(`No cambió duración de Prueba 3: ${JSON.stringify(durationChange.pendingAction?.arguments)}`)
  await confirm(durationChange.pendingAction)
  context = { sessionId, lastSkill: 'calendar', lastResults: [] }
  const collision = await say('Crea un evento el 13 de agosto de 8 de la noche a 9 de la noche con el título Prueba 4')
  const collisionSaved = await confirm(collision.pendingAction)
  cleanup.events.push(collisionSaved.result?.item?.id)
  context = { sessionId, lastSkill: 'calendar', lastResults: [] }
  const blockedMove = await say('Hola FARO mueve el evento Prueba 3 a las 8 de la noche')
  if (blockedMove.status !== 'needs_clarification' || !blockedMove.message.includes('Prueba 4') || !blockedMove.result?.pendingClarification?.missingFields?.includes('alternative_confirmation')) throw new Error(`No detectó el conflicto con el evento exacto: ${JSON.stringify(blockedMove)}`)

  context = { sessionId, lastSkill: 'calendar', lastResults: [] }
  const create = await say('Crea un evento el 12 de agosto de 2 de la tarde a 6 de la tarde con el título Jornada de prueba')
  if (create.status !== 'pending_confirmation') throw new Error(`No propuso el evento: ${create.message}`)
  const created = await confirm(create.pendingAction)
  const eventId = created.result?.item?.id
  if (!eventId) throw new Error('No devolvió eventId.')
  cleanup.events.push(eventId)

  const resize = await say('Cambia la duración para que en lugar de 2 de la tarde a 6 de la tarde sea de 2 de la tarde a 4 de la tarde')
  if (resize.pendingAction?.arguments?.start !== '2026-08-12T20:00:00.000Z' || resize.pendingAction?.arguments?.end !== '2026-08-12T22:00:00.000Z') throw new Error(`Rango incorrecto: ${JSON.stringify(resize.pendingAction?.arguments)}`)
  await confirm(resize.pendingAction)
  const resized = await client.from('calendar_entries').select('starts_at,ends_at').eq('id', eventId).single()
  if (resized.error || resized.data.starts_at !== '2026-08-12T20:00:00+00:00' || resized.data.ends_at !== '2026-08-12T22:00:00+00:00') throw resized.error ?? new Error(`Duración no persistida: ${JSON.stringify(resized.data)}`)

  context = { sessionId, lastSkill: 'calendar', lastResults: [] }
  const titled = await say('Crea un evento el 13 de agosto de 11 de la mañana a 12 del día con el título Título incorrecto')
  if (!titled.pendingAction) throw new Error(`No propuso evento para renombrar: ${titled.message}`)
  const revised = await edge({ type: 'revise', requestId: titled.pendingAction.requestId, title: 'Título corregido' })
  if (revised.pendingAction?.arguments?.title !== 'Título corregido') throw new Error(`No revisó el título: ${revised.message}`)
  const savedTitle = await confirm(revised.pendingAction)
  cleanup.events.push(savedTitle.result?.item?.id)

  context = { sessionId, lastSkill: 'calendar', lastResults: [] }
  const task = await say('No, mejor, genérame una tarea el 14 de agosto de 10 de la mañana a 12 del día en el workspace de BIMSA con el título Pendientes')
  if (task.pendingAction?.arguments?.workspaceId !== prepared.data.bimsaWorkspaceId) throw new Error(`No resolvió BIMSA: ${JSON.stringify(task.pendingAction?.arguments)}`)
  const savedTask = await confirm(task.pendingAction)
  const taskId = savedTask.result?.item?.id
  cleanup.tasks.push(taskId)
  const persistedTask = await client.from('tasks').select('workspace_id,title,estimated_minutes').eq('id', taskId).single()
  if (persistedTask.error || persistedTask.data.workspace_id !== prepared.data.bimsaWorkspaceId || persistedTask.data.title !== 'Pendientes' || persistedTask.data.estimated_minutes !== 120) throw persistedTask.error ?? new Error(`Tarea incorrecta: ${JSON.stringify(persistedTask.data)}`)

  context = { sessionId, lastSkill: 'calendar', lastResults: [] }
  const singleTimeTask = await say('Generarrme una tarea el día martes 18 de agosto a las 12 del día con el título Pendientes por realizar en el workspace de BIMSA')
  if (singleTimeTask.pendingAction?.arguments?.start !== '2026-08-18T18:00:00.000Z' || singleTimeTask.pendingAction?.arguments?.workspaceId !== prepared.data.bimsaWorkspaceId) throw new Error(`La hora única o BIMSA se normalizaron mal: ${JSON.stringify(singleTimeTask)}`)
  const savedSingleTimeTask = await confirm(singleTimeTask.pendingAction)
  cleanup.tasks.push(savedSingleTimeTask.result?.item?.id)

  context = { sessionId, lastSkill: 'calendar', lastResults: [] }
  const byTime = await say('Crea un evento el 25 de agosto de 10:30 de la mañana a 11:30 de la mañana con el título Evento localizado por hora')
  const savedByTime = await confirm(byTime.pendingAction)
  const byTimeId = savedByTime.result?.item?.id
  cleanup.events.push(byTimeId)
  context = { sessionId, lastSkill: 'calendar', lastResults: [] }
  const directMove = await say('Mueve el evento que tengo el 25 de agosto a las 10:30 de la mañana a la una de la tarde')
  if (directMove.pendingAction?.arguments?.targetId !== byTimeId || directMove.pendingAction?.arguments?.start !== '2026-08-25T19:00:00.000Z') throw new Error(`No resolvió origen 10:30 → destino 13:00: ${JSON.stringify(directMove.pendingAction?.arguments)}`)
  await confirm(directMove.pendingAction)

  context = { sessionId, lastSkill: 'calendar', lastResults: [] }
  const foundByTime = await say('Busca el evento que tengo el 25 de agosto a la una de la tarde')
  if (foundByTime.result?.references?.length !== 1 || foundByTime.result.references[0]?.id !== byTimeId) throw new Error(`La búsqueda por fecha + hora no fue exacta: ${JSON.stringify(foundByTime.result?.references)}`)
  const contextualMove = await say('Sí, ese evento, muévelo a las 3 de la tarde')
  if (contextualMove.pendingAction?.arguments?.targetId !== byTimeId || contextualMove.pendingAction?.arguments?.start !== '2026-08-25T21:00:00.000Z') throw new Error(`No reutilizó la referencia encontrada: ${JSON.stringify(contextualMove.pendingAction?.arguments)}`)

  context = { sessionId, lastSkill: 'calendar', lastResults: [] }
  const movable = await say('Crea un evento el 15 de agosto de 7 de la mañana a 8 de la mañana con el título Evento movible')
  const savedMovable = await confirm(movable.pendingAction)
  cleanup.events.push(savedMovable.result?.item?.id)
  const movableReference = savedMovable.result?.reference
  context = { sessionId, lastSkill: 'calendar', lastResults: [] }
  const blocker = await say('Crea un evento el 15 de agosto de 9 de la mañana a 10 de la mañana con el título Evento bloqueador')
  const savedBlocker = await confirm(blocker.pendingAction)
  cleanup.events.push(savedBlocker.result?.item?.id)
  context = { sessionId, lastSkill: 'calendar', lastResults: [movableReference] }
  const conflict = await say('Mueve este evento a las 9 de la mañana')
  if (!conflict.result?.pendingClarification?.missingFields?.includes('alternative_confirmation')) throw new Error(`No conservó la búsqueda de alternativas: ${conflict.message}`)
  const alternatives = await say('Sí')
  if (alternatives.qa?.intent !== 'find_available_slots' || !alternatives.message.includes('Tengo libres')) throw new Error(`No buscó alternativas al confirmar: ${alternatives.message}`)

  console.log(JSON.stringify({ list: list.message, resized: resized.data, revisedTitle: 'Título corregido', bimsaTask: persistedTask.data, singleTimeTask: singleTimeTask.pendingAction.arguments, directMove: directMove.pendingAction.arguments, contextualMove: contextualMove.pendingAction.arguments, alternatives: alternatives.message }, null, 2))
} finally {
  if (cleanup.events.filter(Boolean).length) await client.from('calendar_entries').delete().in('id', cleanup.events.filter(Boolean))
  if (cleanup.tasks.filter(Boolean).length) await client.from('tasks').delete().in('id', cleanup.tasks.filter(Boolean))
  await client.auth.signOut()
}
