import { createClient } from 'npm:@supabase/supabase-js@2'
import { accessToken, decryptRefreshToken, googleRequest } from '../googleCalendar.ts'
import { normalizeVoiceText } from './financeFastPath.ts'
import { routeCalendarIntent, type CalendarFastIntent } from './calendarFastPath.ts'
import { formatTimeForSpeech } from './timeForSpeech.ts'
import type { ServerVoiceTrace } from './trace.ts'
import { resolveExplicitCalendarDate } from './calendarDateTime.ts'

type Db = ReturnType<typeof createClient>
type Reference = { id: string; type: 'calendar_event' | 'calendar_task' | 'google_event' | 'calendar_slot'; title: string; subtitle?: string }
type SessionContext = {
  lastSkill?: string
  lastResults?: Reference[]
  pendingClarification?: { intent?: string; missingFields?: string[]; entities?: Record<string, unknown> }
}
type ClientCalendarItem = { id: string; kind: 'event' | 'task'; title: string; start: string; end?: string; allDay?: boolean; workspaceId?: string }
type LocalContext = { now: string; timezone: string; calendarItems?: ClientCalendarItem[] }
type CalendarItem = {
  id: string
  kind: 'event' | 'task' | 'google'
  title: string
  start: string
  end: string
  provider: 'faro' | 'google'
  etag?: string
  calendarId?: string
  workspaceId?: string
  clientSnapshot?: boolean
}
export type CalendarResolution =
  | { kind: 'read'; intent: CalendarFastIntent; message: string; result: unknown; references?: Reference[] }
  | { kind: 'clarify'; intent: CalendarFastIntent; message: string; references?: Reference[]; missingFields?: string[]; entities?: Record<string, unknown> }
  | { kind: 'action'; intent: CalendarFastIntent; toolName: string; arguments: Record<string, unknown>; summary: string; prompt: string }

const weekdays: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 }
const pad = (value: number) => String(value).padStart(2, '0')
const moneylessTime = (iso: string, timezone: string) => new Intl.DateTimeFormat('es-MX', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
const dayLabel = (iso: string, timezone: string) => new Intl.DateTimeFormat('es-MX', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso))

function zonedParts(date: Date, timezone: string) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]))
}

function localDate(date: Date, timezone: string) {
  const parts = zonedParts(date, timezone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function addDate(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number)
  const value = new Date(Date.UTC(year, month - 1, day + days, 12))
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
}

function zonedIso(date: string, time: string, timezone: string) {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const intended = Date.UTC(year, month - 1, day, hour, minute)
  let instant = new Date(intended)
  for (let index = 0; index < 2; index += 1) {
    const parts = zonedParts(instant, timezone)
    const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
    instant = new Date(intended - (wall - instant.getTime()))
  }
  return instant.toISOString()
}

function rangeFor(message: string, local: LocalContext) {
  const normalized = normalizeVoiceText(message)
  const today = localDate(new Date(local.now), local.timezone)
  const explicit = resolveExplicitCalendarDate(message, today)
  let date = explicit ?? today
  if (!explicit) {
    if (/\bmanana\b/.test(normalized)) date = addDate(today, 1)
    else {
      const found = Object.entries(weekdays).find(([name]) => new RegExp(`\\b${name}\\b`).test(normalized))
      if (found) {
        const nowDay = new Date(`${today}T12:00:00Z`).getUTCDay()
        let delta = (found[1] - nowDay + 7) % 7
        if (delta === 0 && !/\bhoy\b/.test(normalized)) delta = 7
        date = addDate(today, delta)
      }
    }
  }
  if (/\besta semana\b|\bsemana\b|\bque sigue\b|\bsiguiente compromiso\b|\bproximo compromiso\b|\bcompromiso mas proximo\b/.test(normalized)) {
    const start = zonedIso(today, '00:00', local.timezone)
    return { date: today, start, end: new Date(new Date(start).getTime() + 7 * 86400000).toISOString() }
  }
  return { date, start: zonedIso(date, '00:00', local.timezone), end: zonedIso(addDate(date, 1), '00:00', local.timezone) }
}

function hasDateAnchor(message: string, local: LocalContext) {
  const today = localDate(new Date(local.now), local.timezone)
  return Boolean(resolveExplicitCalendarDate(message, today) || /\b(hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|semana)\b/.test(normalizeVoiceText(message)))
}

function rangeForDate(date: string, local: LocalContext) {
  return { date, start: zonedIso(date, '00:00', local.timezone), end: zonedIso(addDate(date, 1), '00:00', local.timezone) }
}

function titleKey(value: string) {
  return normalizeVoiceText(value).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

function cleanTitle(value: string | undefined) {
  return value?.trim().replace(/^["“]|["”.,?!]+$/g, '').trim()
}

function isPlaceholderTitle(value: string, kind: 'event' | 'task') {
  const title = titleKey(value)
  if (!title) return true
  const placeholders = kind === 'event'
    ? ['evento', 'un evento', 'mi calendario', 'en mi calendario', 'calendario', 'mi agenda', 'en mi agenda', 'agenda']
    : ['tarea', 'una tarea', 'mi calendario', 'en mi calendario', 'calendario', 'mi agenda', 'en mi agenda', 'agenda']
  return placeholders.includes(title) || /^(?:en )?(?:mi )?(?:calendario|agenda)(?: personal)?$/.test(title)
}

function titleFrom(message: string, kind: 'event' | 'task') {
  const cleaned = message.trim().replace(/[.?!]+$/, '')
  const boundary = String.raw`hoy|mañana|manana|el\s+(?:(?:día|dia)\s+)?(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|\d{1,2})|\d{1,2}\s+de\s+\p{L}+|a\s+las?|a\s+la|por\s+\d|de\s+\d|durante\s+\d|en\s+el\s+workspace`
  const explicit = cleanTitle(cleaned.match(new RegExp(`\\b(?:titulo|título|llamado|llamada)\\s+(.+?)(?:\\s+(?:${boundary})|$)`, 'iu'))?.[1])
  if (explicit && !isPlaceholderTitle(explicit, kind)) return explicit.slice(0, 120)
  const source = kind === 'task'
    ? String.raw`(?:tarea|trabajar|terminar|avanzar)(?:\s+de|\s+en|\s+para)?\s+(.+?)`
    : String.raw`(?:reunión|reunion|evento|cita|agenda(?:r)?|dentista|llamada)(?:\s+con|\s+de|\s+para)?\s*(.+?)`
  const inferred = cleanTitle(new RegExp(`${source}(?:\\s+(?:${boundary})|$)`, 'iu').exec(cleaned)?.[1])
  if (kind === 'event' && /\bdentista\b/i.test(message)) return 'Cita con dentista'
  return inferred && inferred.length > 1 && !/^el\s+d[ií]a\b/i.test(inferred) && !isPlaceholderTitle(inferred, kind)
    ? inferred.slice(0, 120)
    : undefined
}

function refs(items: CalendarItem[]): Reference[] {
  return items.slice(0, 10).map((item) => ({
    id: item.kind === 'google' ? `${item.calendarId}::${item.id}` : item.id,
    type: item.kind === 'task' ? 'calendar_task' : item.kind === 'google' ? 'google_event' : 'calendar_event',
    title: item.title,
    subtitle: `${item.start} · ${item.provider}${item.etag ? ` · ${item.etag}` : ''}`,
  }))
}

function dayReference(iso: string, local: LocalContext) {
  const date = localDate(new Date(iso), local.timezone)
  const today = localDate(new Date(local.now), local.timezone)
  if (date === today) return 'hoy'
  if (date === addDate(today, 1)) return 'mañana'
  return `el ${dayLabel(iso, local.timezone)}`
}

function durationLabel(minutes: number) {
  if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? 'hora' : 'horas'}`
  return `${minutes} minutos`
}

function selectTitleMatches(items: CalendarItem[], requestedTitle: string) {
  const query = titleKey(requestedTitle)
  const exact = items.filter((item) => titleKey(item.title) === query)
  if (exact.length) return exact
  return items.filter((item) => {
    const candidate = titleKey(item.title)
    return candidate.includes(query) || query.includes(candidate)
  })
}

function clarificationForMatches(intent: CalendarFastIntent, matches: CalendarItem[], timezone: string) {
  return {
    kind: 'clarify' as const,
    intent,
    message: `Encontré varias coincidencias:\n${matches.slice(0, 3).map((item, index) => `${index + 1}. ${item.title} · ${formatTimeForSpeech(item.start, timezone)}`).join('\n')}\n¿Cuál corresponde?`,
    references: refs(matches),
  }
}

async function googleItems(db: Db, userId: string, start: string, end: string, trace: ServerVoiceTrace) {
  const { data } = await db.from('google_calendar_connections').select('*').eq('user_id', userId).maybeSingle()
  if (!data || data.status !== 'active' || !data.calendar_id) return [] as CalendarItem[]
  try {
    const token = await accessToken(await decryptRefreshToken(data.encrypted_refresh_token, data.refresh_token_iv))
    const payload = await trace.measure('googleApi', () => googleRequest(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(data.calendar_id)}/events?${new URLSearchParams({ timeMin: start, timeMax: end, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' }).toString()}`, token))
    return (payload.items ?? []).flatMap((event: Record<string, any>) => event.status === 'cancelled' || !event.id ? [] : [{
      id: String(event.id), kind: 'google' as const, title: String(event.summary ?? 'Evento de Google'),
      start: String(event.start?.dateTime ?? `${event.start?.date}T00:00:00Z`),
      end: String(event.end?.dateTime ?? `${event.end?.date}T00:00:00Z`), provider: 'google' as const,
      etag: String(event.etag ?? ''), calendarId: data.calendar_id,
    }])
  } catch {
    return [] as CalendarItem[]
  }
}

function clientItems(items: ClientCalendarItem[] | undefined, start: string, end: string, timezone: string) {
  const rangeStart = new Date(start).getTime()
  const rangeEnd = new Date(end).getTime()
  return (items ?? []).flatMap((item): CalendarItem[] => {
    let itemStart: string
    let itemEnd: string
    if (item.allDay) {
      const date = item.start.slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return []
      itemStart = zonedIso(date, '00:00', timezone)
      itemEnd = zonedIso(addDate(date, 1), '00:00', timezone)
    } else {
      const from = new Date(item.start)
      if (!Number.isFinite(from.getTime())) return []
      const to = item.end ? new Date(item.end) : new Date(from.getTime() + 30 * 60000)
      if (!Number.isFinite(to.getTime()) || to <= from) return []
      itemStart = from.toISOString()
      itemEnd = to.toISOString()
    }
    if (new Date(itemEnd).getTime() <= rangeStart || new Date(itemStart).getTime() >= rangeEnd) return []
    return [{ id: item.id, kind: item.kind, title: item.title, start: itemStart, end: itemEnd, provider: 'faro', workspaceId: item.workspaceId, clientSnapshot: true }]
  })
}

async function loadItems(db: Db, userId: string, start: string, end: string, trace: ServerVoiceTrace, local: LocalContext) {
  return trace.measure('calendarContext', async () => {
    const [entries, tasks, fixtures, google] = await Promise.all([
      db.from('calendar_entries').select('id,title,starts_at,ends_at,workspace_id').eq('user_id', userId).lt('starts_at', end).gt('ends_at', start),
      db.from('tasks').select('id,title,due_at,estimated_minutes,workspace_id').eq('user_id', userId).is('archived_at', null).gte('due_at', start).lt('due_at', end),
      db.from('calendar_voice_fixtures').select('id,title,starts_at,ends_at,source,calendar_id,external_id,etag').eq('user_id', userId).lt('starts_at', end).gt('ends_at', start),
      googleItems(db, userId, start, end, trace),
    ])
    if (entries.error) throw entries.error
    if (tasks.error) throw tasks.error
    if (fixtures.error && fixtures.error.code !== '42P01') throw fixtures.error
    const unique = new Map<string, CalendarItem>()
    for (const item of [
      ...(entries.data ?? []).map((row) => ({ id: row.id, kind: 'event' as const, title: row.title, start: row.starts_at, end: row.ends_at, provider: 'faro' as const, workspaceId: row.workspace_id ?? undefined })),
      ...(tasks.data ?? []).flatMap((row) => !row.due_at?.includes('T') ? [] : [{ id: row.id, kind: 'task' as const, title: row.title, start: row.due_at, end: new Date(new Date(row.due_at).getTime() + Math.max(15, row.estimated_minutes ?? 30) * 60000).toISOString(), provider: 'faro' as const, workspaceId: row.workspace_id ?? undefined }]),
      ...(fixtures.data ?? []).map((row) => ({ id: row.external_id ?? row.id, kind: 'google' as const, title: row.title, start: row.starts_at, end: row.ends_at, provider: 'google' as const, etag: row.etag ?? undefined, calendarId: row.calendar_id ?? 'lab-google' })),
      ...google,
      ...clientItems(local.calendarItems, start, end, local.timezone),
    ]) unique.set(`${item.kind}:${item.id}`, item)
    return [...unique.values()].sort((a, b) => a.start.localeCompare(b.start))
  })
}

function slots(items: CalendarItem[], range: { start: string; end: string }, duration: number, local: LocalContext, startAfter?: string) {
  const found: Array<{ start: string; end: string }> = []
  const rangeEnd = new Date(range.end).getTime()
  const now = new Date(local.now).getTime()
  let day = localDate(new Date(range.start), local.timezone)
  for (let offset = 0; offset < 8 && found.length < 3; offset += 1, day = addDate(day, 1)) {
    const dayStart = new Date(zonedIso(day, offset === 0 ? startAfter ?? '07:00' : '07:00', local.timezone)).getTime()
    let cursor = Math.max(dayStart, now)
    const limit = Math.min(rangeEnd, new Date(zonedIso(addDate(day, 1), '00:00', local.timezone)).getTime())
    if (cursor >= limit) continue
    const busy = items.map((item) => [new Date(item.start).getTime(), new Date(item.end).getTime()] as const).filter(([from, to]) => to > cursor && from < limit).sort((a, b) => a[0] - b[0])
    for (const [from, to] of busy) {
      if (Math.min(from, limit) - cursor >= duration * 60000) found.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + duration * 60000).toISOString() })
      cursor = Math.max(cursor, to)
      if (found.length >= 3) break
    }
    if (found.length < 3 && limit - cursor >= duration * 60000) found.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + duration * 60000).toISOString() })
  }
  return found.slice(0, 3)
}

function selectedRef(context: SessionContext | undefined, ordinal?: number) {
  const list = context?.lastResults ?? []
  return list[(ordinal ?? 1) - 1]
}

async function byReference(db: Db, userId: string, reference: Reference | undefined, trace: ServerVoiceTrace) {
  if (!reference) return null
  if (reference.type === 'calendar_event') {
    const { data, error } = await db.from('calendar_entries').select('id,title,starts_at,ends_at,workspace_id').eq('user_id', userId).eq('id', reference.id).maybeSingle()
    if (error) throw error
    return data ? { id: data.id, kind: 'event' as const, title: data.title, start: data.starts_at, end: data.ends_at, provider: 'faro' as const, workspaceId: data.workspace_id ?? undefined } : null
  }
  if (reference.type === 'calendar_task') {
    const { data, error } = await db.from('tasks').select('id,title,due_at,estimated_minutes,workspace_id').eq('user_id', userId).eq('id', reference.id).maybeSingle()
    if (error) throw error
    return data?.due_at ? { id: data.id, kind: 'task' as const, title: data.title, start: data.due_at, end: new Date(new Date(data.due_at).getTime() + Math.max(15, data.estimated_minutes ?? 30) * 60000).toISOString(), provider: 'faro' as const, workspaceId: data.workspace_id ?? undefined } : null
  }
  if (reference.type !== 'google_event') return null
  const separator = reference.id.indexOf('::')
  const calendarId = separator >= 0 ? reference.id.slice(0, separator) : ''
  const eventId = separator >= 0 ? reference.id.slice(separator + 2) : reference.id
  const { data: fixture } = await db.from('calendar_voice_fixtures').select('title,starts_at,ends_at,etag,calendar_id,external_id').eq('user_id', userId).eq('calendar_id', calendarId).eq('external_id', eventId).maybeSingle()
  if (fixture) return { id: eventId, kind: 'google' as const, title: fixture.title, start: fixture.starts_at, end: fixture.ends_at, provider: 'google' as const, etag: fixture.etag ?? undefined, calendarId: fixture.calendar_id }
  const { data: connection } = await db.from('google_calendar_connections').select('*').eq('user_id', userId).eq('calendar_id', calendarId).maybeSingle()
  if (!connection) return null
  try {
    const token = await accessToken(await decryptRefreshToken(connection.encrypted_refresh_token, connection.refresh_token_iv))
    const event = await trace.measure('googleApi', () => googleRequest(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, token))
    return { id: String(event.id), kind: 'google' as const, title: String(event.summary ?? 'Evento de Google'), start: String(event.start?.dateTime ?? `${event.start?.date}T00:00:00Z`), end: String(event.end?.dateTime ?? `${event.end?.date}T00:00:00Z`), provider: 'google' as const, etag: String(event.etag ?? ''), calendarId }
  } catch {
    return null
  }
}

export async function resolveFastCalendar(db: Db, userId: string, rawMessage: string, context: SessionContext | undefined, local: LocalContext | undefined, trace: ServerVoiceTrace): Promise<CalendarResolution | null> {
  if (!local || !Number.isFinite(new Date(local.now).getTime())) return null
  try { new Intl.DateTimeFormat('en-US', { timeZone: local.timezone }) } catch { return null }

  const prior = context?.pendingClarification
  const route = trace.measureSync('routing', () => routeCalendarIntent(rawMessage))
  const normalized = route.entities.normalized
  const acceptedAlternatives = Boolean(prior?.missingFields?.includes('alternative_confirmation') && /^(si|sí|claro|vale|ok|busca|buscalas|buscar alternativas)[.! ]*$/.test(rawMessage.trim().toLocaleLowerCase('es-MX')))
  let intent = acceptedAlternatives ? 'find_available_slots' as CalendarFastIntent : route.intent
  const contextualContinuation = Boolean(route.entities.ordinal || route.entities.time || route.entities.sourceTime || route.entities.relativeMinutes || acceptedAlternatives || prior?.missingFields?.some((field) => ['title', 'time', 'target', 'workspace'].includes(field)))
  if (intent === 'unknown' && prior?.intent && contextualContinuation) intent = prior.intent as CalendarFastIntent
  if (intent === 'unknown') return null

  let requestedRange = rangeFor(rawMessage, local)
  const priorDate = typeof prior?.entities?.date === 'string' ? prior.entities.date : ''
  if (priorDate && !hasDateAnchor(rawMessage, local)) requestedRange = rangeForDate(priorDate, local)
  const today = localDate(new Date(local.now), local.timezone)
  const range = intent === 'update_calendar_event' || intent === 'delete_calendar_event'
    ? { date: requestedRange.date, start: zonedIso(today, '00:00', local.timezone), end: zonedIso(addDate(today, 90), '00:00', local.timezone) }
    : requestedRange
  const all = await loadItems(db, userId, range.start, range.end, trace, local)
  const targetPool = hasDateAnchor(rawMessage, local) || Boolean(priorDate)
    ? all.filter((item) => localDate(new Date(item.start), local.timezone) === requestedRange.date)
    : all

  if (intent === 'list_calendar_items' || intent === 'get_next_commitment') {
    const now = new Date(local.now).getTime()
    const listed = route.entities.time ? all.filter((item) => moneylessTime(item.start, local.timezone) === route.entities.time) : all
    const chosen = intent === 'get_next_commitment' ? listed.filter((item) => new Date(item.end).getTime() > now).slice(0, 1) : listed
    const message = !chosen.length
      ? `No tienes compromisos ${/manana/.test(normalized) ? 'mañana' : 'en ese periodo'}.`
      : /\ba que hora termino\b/.test(normalized)
        ? `Tu último compromiso termina a las ${formatTimeForSpeech(chosen.at(-1)!.end, local.timezone)}.`
        : intent === 'get_next_commitment'
          ? `Tu compromiso más próximo es ${dayReference(chosen[0].start, local)} a las ${formatTimeForSpeech(chosen[0].start, local.timezone)}: ${chosen[0].title}.`
          : chosen.map((item) => `${formatTimeForSpeech(item.start, local.timezone)} · ${item.title}`).join('\n')
    return { kind: 'read', intent, message, result: { items: chosen, timezone: local.timezone }, references: refs(chosen) }
  }

  if (intent === 'find_available_slots') {
    const duration = route.entities.durationMinutes ?? Number(prior?.entities?.durationMinutes ?? 60)
    const open = trace.measureSync('conflictDetection', () => slots(all, range, duration, local, route.entities.time))
    const references: Reference[] = open.map((slot, index) => ({ id: `${slot.start}|${slot.end}`, type: 'calendar_slot', title: `Opción ${index + 1}: ${formatTimeForSpeech(slot.start, local.timezone)}–${formatTimeForSpeech(slot.end, local.timezone)}`, subtitle: dayLabel(slot.start, local.timezone) }))
    return { kind: 'read', intent, message: references.length ? `Tengo libres:\n${references.map((item) => item.title).join('\n')}` : 'No encontré un bloque libre con esa duración.', result: { slots: open, durationMinutes: duration, timezone: local.timezone }, references }
  }

  if (intent === 'find_calendar_event') {
    const lookupTime = route.entities.sourceTime ?? route.entities.time
    const words = normalized.split(' ').filter((word) => word.length > 3 && !['busca', 'buscar', 'encuentra', 'evento', 'reunion', 'agenda', 'calendario', 'tengo', 'manana', 'hora'].includes(word))
    const timed = lookupTime ? targetPool.filter((item) => moneylessTime(item.start, local.timezone) === lookupTime) : targetPool
    const found = timed.filter((item) => words.some((word) => titleKey(item.title).includes(word)))
    const chosen = lookupTime ? (found.length ? found : timed) : (found.length ? found : targetPool)
    return { kind: 'read', intent, message: chosen.length ? chosen.slice(0, 5).map((item, index) => `${index + 1}. ${item.title} · ${formatTimeForSpeech(item.start, local.timezone)}`).join('\n') : 'No encontré coincidencias.', result: { items: chosen }, references: refs(chosen) }
  }

  if (intent === 'create_calendar_event' || intent === 'create_scheduled_task') {
    const kind = intent === 'create_scheduled_task' ? 'task' : 'event'
    const duration = route.entities.durationMinutes ?? Number(prior?.entities?.durationMinutes ?? (kind === 'task' ? 120 : 60))
    const title = titleFrom(rawMessage, kind) ?? String(prior?.entities?.title ?? '')
    const workspaceName = route.entities.workspaceName ?? (typeof prior?.entities?.workspaceName === 'string' ? prior.entities.workspaceName : undefined)
    let start: string | undefined
    if (route.entities.ordinal) {
      const slot = context?.lastResults?.[route.entities.ordinal - 1]
      if (slot?.type === 'calendar_slot') start = slot.id.split('|')[0]
    }
    if (!start && route.entities.time) start = zonedIso(range.date, route.entities.time, local.timezone)
    if (!title) return { kind: 'clarify', intent, message: kind === 'task' ? '¿Qué resultado debe tener la tarea?' : '¿Cuál es el título del evento?', missingFields: ['title'], entities: { originalMessage: rawMessage, date: range.date, durationMinutes: duration, workspaceName } }
    if (!start) return { kind: 'clarify', intent, message: '¿A qué hora lo programo?', missingFields: ['time'], entities: { originalMessage: rawMessage, date: range.date, title, durationMinutes: duration, workspaceName } }
    let end = route.entities.endTime ? zonedIso(range.date, route.entities.endTime, local.timezone) : new Date(new Date(start).getTime() + duration * 60000).toISOString()
    if (new Date(end) <= new Date(start) && route.entities.endTime) end = zonedIso(addDate(range.date, 1), route.entities.endTime, local.timezone)
    const effectiveDuration = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
    const conflicts = trace.measureSync('conflictDetection', () => all.filter((item) => new Date(item.start) < new Date(end) && new Date(item.end) > new Date(start)))
    if (conflicts.length) {
      const alternatives = slots(all, range, effectiveDuration, local, moneylessTime(start, local.timezone))
      const references: Reference[] = alternatives.map((slot, index) => ({ id: `${slot.start}|${slot.end}`, type: 'calendar_slot', title: `Opción ${index + 1}: ${formatTimeForSpeech(slot.start, local.timezone)}–${formatTimeForSpeech(slot.end, local.timezone)}` }))
      return { kind: 'clarify', intent, message: `Ya tienes “${conflicts[0].title}” a las ${formatTimeForSpeech(conflicts[0].start, local.timezone)}${conflicts[0].provider === 'google' ? ' en Google Calendar' : ''}.${references.length ? ` Tengo libres ${references.map((item) => item.title.replace(/^Opción \d+: /, '')).join(', ')}.` : ''}`, references, entities: { originalMessage: rawMessage, date: range.date, title, durationMinutes: effectiveDuration, workspaceName, intent: 'calendar_conflict' } }
    }
    const id = crypto.randomUUID()
    const toolName = kind === 'task' ? 'createScheduledTask' : 'createCalendarEvent'
    const args = kind === 'task'
      ? { taskId: id, title, start, end, durationMinutes: effectiveDuration, workspaceId: null }
      : { eventId: id, title, start, end, provider: 'faro', timezone: local.timezone }
    return { kind: 'action', intent, toolName, arguments: args, summary: `${kind === 'task' ? 'Tarea' : 'Evento'} “${title}” · ${dayLabel(start, local.timezone)} ${moneylessTime(start, local.timezone)}–${moneylessTime(end, local.timezone)} · faro.`, prompt: `Voy a agregar “${title}” el ${dayLabel(start, local.timezone)} de ${moneylessTime(start, local.timezone)} a ${moneylessTime(end, local.timezone)}. ¿Confirmas?` }
  }

  const explicitTitle = route.entities.targetTitle
  const priorNeedsTarget = prior?.missingFields?.includes('target') ?? false
  const locatorTime = route.entities.sourceTime ?? (priorNeedsTarget ? route.entities.time : undefined)
  let target: CalendarItem | null = null

  if (explicitTitle) {
    const matches = selectTitleMatches(targetPool, explicitTitle)
    if (matches.length === 1) target = matches[0]
    else if (matches.length > 1) return clarificationForMatches(intent, matches, local.timezone)
    else return { kind: 'clarify', intent, message: `No encontré un evento o tarea llamado “${explicitTitle}”. ¿Cuál quieres modificar?`, missingFields: ['target'], entities: { originalMessage: rawMessage, date: requestedRange.date } }
  }

  // A clock explicitly attached to the event is a locator, not a destination.
  // It therefore wins over stale conversational context.
  if (!target && locatorTime) {
    const timed = targetPool.filter((item) => moneylessTime(item.start, local.timezone) === locatorTime)
    if (timed.length === 1) target = timed[0]
    else if (timed.length > 1) {
      return { kind: 'clarify', intent, message: `Encontré varios elementos a las ${formatTimeForSpeech(timed[0].start, local.timezone)}:\n${timed.slice(0, 3).map((item, index) => `${index + 1}. ${item.title} · ${dayLabel(item.start, local.timezone)}`).join('\n')}\n¿Cuál corresponde?`, references: refs(timed) }
    }
  }

  if (!target) {
    const contextual = selectedRef(context, route.entities.ordinal)
    target = await byReference(db, userId, contextual, trace)
    if (!target && contextual) {
      const contextualId = contextual.type === 'google_event' ? (contextual.id.includes('::') ? contextual.id.split('::').slice(1).join('::') : contextual.id) : contextual.id
      target = targetPool.find((item) => item.id === contextualId) ?? null
    }
  }

  if (!target) {
    const ignored = new Set(['mueve', 'mover', 'recorre', 'elimina', 'borra', 'evento', 'reunion', 'tarea', 'mejor', 'hora', 'titulo', 'nombre', 'cambiale', 'duracion', 'noche', 'tarde', 'manana', 'despues', 'antes', 'prueba'])
    const words = normalized.split(' ').filter((word) => word.length > 3 && !ignored.has(word))
    const matches = targetPool.filter((item) => words.some((word) => titleKey(item.title).includes(word)))
    if (matches.length === 1) target = matches[0]
    else if (matches.length > 1) return clarificationForMatches(intent, matches, local.timezone)
  }

  if (!target) return { kind: 'clarify', intent, message: '¿Qué evento o tarea quieres modificar?', missingFields: ['target'], entities: { originalMessage: rawMessage, relativeMinutes: route.entities.relativeMinutes ?? prior?.entities?.relativeMinutes, destinationTime: route.entities.time ?? prior?.entities?.destinationTime, date: requestedRange.date } }
  if (target.provider === 'google') return { kind: 'read', intent, message: 'Ese evento viene de Google Calendar y FARO sólo tiene acceso de lectura.', result: { readOnly: true, item: target }, references: refs([target]) }
  if (intent === 'delete_calendar_event') return { kind: 'action', intent, toolName: 'deleteCalendarEvent', arguments: { targetId: target.id, targetKind: target.kind, provider: 'faro' }, summary: `Eliminar “${target.title}” del ${dayLabel(target.start, local.timezone)}.`, prompt: `¿Confirmas que elimine “${target.title}”?` }

  const updateKind = route.entities.updateKind
  const newTitle = route.entities.newTitle
  const originalStart = target.start
  const originalEnd = target.end
  const originalDuration = new Date(originalEnd).getTime() - new Date(originalStart).getTime()
  const targetDate = localDate(new Date(target.start), local.timezone)
  let start = originalStart
  let end = originalEnd

  if (updateKind === 'duration') {
    if (route.entities.time && route.entities.endTime) {
      const date = hasDateAnchor(rawMessage, local) ? requestedRange.date : targetDate
      start = zonedIso(date, route.entities.time, local.timezone)
      end = zonedIso(date, route.entities.endTime, local.timezone)
      if (new Date(end) <= new Date(start)) end = zonedIso(addDate(date, 1), route.entities.endTime, local.timezone)
    } else if (route.entities.durationMinutes) {
      end = new Date(new Date(start).getTime() + route.entities.durationMinutes * 60000).toISOString()
    } else {
      return { kind: 'clarify', intent, message: `¿Cuánto quieres que dure “${target.title}”?`, references: refs([target]), missingFields: ['duration'], entities: { originalMessage: rawMessage, targetId: target.id, targetKind: target.kind, date: targetDate } }
    }
  } else {
    const relativeMinutes = route.entities.relativeMinutes ?? Number(prior?.entities?.relativeMinutes ?? 0)
    const destinationTime = route.entities.sourceTime && priorNeedsTarget ? String(prior?.entities?.destinationTime ?? '') : route.entities.time ?? String(prior?.entities?.destinationTime ?? '')
    if (relativeMinutes) {
      start = new Date(new Date(start).getTime() + relativeMinutes * 60000).toISOString()
      end = new Date(new Date(start).getTime() + originalDuration).toISOString()
    } else if (destinationTime) {
      start = zonedIso(targetDate, destinationTime, local.timezone)
      end = new Date(new Date(start).getTime() + originalDuration).toISOString()
    } else if (!newTitle) {
      return { kind: 'clarify', intent, message: '¿A qué hora quieres moverlo?', references: refs([target]), missingFields: ['time'], entities: { originalMessage: rawMessage, targetId: target.id, targetKind: target.kind, date: targetDate } }
    }
  }

  const effectiveDuration = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  const scheduleChanged = new Date(start).getTime() !== new Date(originalStart).getTime() || new Date(end).getTime() !== new Date(originalEnd).getTime()
  const conflicts = scheduleChanged ? all.filter((item) => item.id !== target!.id && new Date(item.start) < new Date(end) && new Date(item.end) > new Date(start)) : []
  if (conflicts.length) {
    return { kind: 'clarify', intent, message: `No puedo actualizarlo: coincide con “${conflicts[0].title}”${conflicts[0].provider === 'google' ? ' de Google Calendar' : ''}. ¿Busco alternativas?`, references: refs([target]), missingFields: ['alternative_confirmation'], entities: { originalMessage: rawMessage, date: localDate(new Date(start), local.timezone), durationMinutes: effectiveDuration, targetId: target.id, targetKind: target.kind, title: target.title } }
  }

  const arguments_ = { targetId: target.id, targetKind: target.kind, provider: 'faro', start, end, title: newTitle ?? null }
  if (newTitle) return { kind: 'action', intent, toolName: 'updateCalendarEvent', arguments: arguments_, summary: `Cambiar el título de “${target.title}” a “${newTitle}”.`, prompt: `Voy a cambiar el título de “${target.title}” a “${newTitle}”. ¿Confirmas?` }
  if (updateKind === 'duration') return { kind: 'action', intent, toolName: 'updateCalendarEvent', arguments: arguments_, summary: `Cambiar la duración de “${target.title}” a ${durationLabel(effectiveDuration)}.`, prompt: `Voy a cambiar la duración de “${target.title}” a ${durationLabel(effectiveDuration)}. ¿Confirmas?` }
  return { kind: 'action', intent, toolName: 'updateCalendarEvent', arguments: arguments_, summary: `Mover “${target.title}” a ${dayLabel(start, local.timezone)} ${moneylessTime(start, local.timezone)}.`, prompt: `¿Confirmas que mueva “${target.title}” a la ${formatTimeForSpeech(start, local.timezone)}?` }
}
