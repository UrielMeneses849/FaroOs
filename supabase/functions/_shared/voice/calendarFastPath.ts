import { normalizeVoiceText } from './financeFastPath.ts'
import { extractCalendarTimeRange } from './calendarDateTime.ts'

export type CalendarFastIntent =
  | 'list_calendar_items'
  | 'get_next_commitment'
  | 'find_calendar_event'
  | 'find_available_slots'
  | 'create_calendar_event'
  | 'create_scheduled_task'
  | 'update_calendar_event'
  | 'delete_calendar_event'
  | 'unknown'

export type CalendarFastRoute = {
  skill: 'calendar'
  intent: CalendarFastIntent
  confidence: number
  entities: {
    normalized: string
    time?: string
    endTime?: string
    sourceTime?: string
    durationMinutes?: number
    ordinal?: number
    relativeMinutes?: number
    provider?: 'faro' | 'google'
    newTitle?: string
    workspaceName?: string
    targetTitle?: string
    updateKind?: 'move' | 'duration' | 'rename'
  }
}

const numbers: Record<string, number> = { una:1, un:1, uno:1, dos:2, tres:3, cuatro:4, cinco:5, seis:6, siete:7, ocho:8, nueve:9, diez:10, once:11, doce:12 }

function clock(value: string) {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-MX')
  const period = String.raw`am|pm|de la manana|por la manana|de la tarde|por la tarde|de la noche|por la noche`
  const explicit = normalized.match(new RegExp(`\\b(?:a\\s+las?|a\\s+la|desde\\s+las?|despues\\s+de\\s+las?)\\s+(\\d{1,2})(?::(\\d{2})|\\s+y\\s+(media|cuarto))?\\s*(${period})?\\b`))
  const word = normalized.match(new RegExp(`\\b(?:a\\s+las?|a\\s+la|desde\\s+las?|despues\\s+de\\s+las?)\\s+(una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?:\\s+y\\s+(media|cuarto))?\\s*(${period})?\\b`))
  let hour = explicit ? Number(explicit[1]) : word ? numbers[word[1]] : undefined
  if (hour === undefined || hour > 23) return undefined
  const naturalMinute = explicit?.[3] ?? word?.[2]
  const minute = explicit?.[2] ? Number(explicit[2]) : naturalMinute === 'media' ? 30 : naturalMinute === 'cuarto' ? 15 : 0
  const suffix = explicit?.[4] ?? word?.[3]
  if ((suffix === 'pm' || suffix?.includes('tarde') || suffix?.includes('noche')) && hour < 12) hour += 12
  if (!suffix && hour >= 1 && hour <= 7) hour += 12
  if ((suffix === 'am' || suffix?.includes('manana')) && hour === 12) hour = 0
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function sourceClock(value: string) {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-MX')
  const candidate = normalized.match(/\b(?:evento|reunion|cita|tarea)\s+de\s+(?:las?\s+)?((?:\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?::\d{2})?(?:\s+y\s+(?:media|cuarto))?(?:\s+(?:de la manana|de la tarde|de la noche|am|pm))?)/)?.[1]
    ?? normalized.match(/\b(?:que\s+)?(?:inicia|empieza|comienza|esta programad[oa])\s+(?:a\s+las?|a\s+la)\s+((?:\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?::\d{2})?(?:\s+(?:de la manana|de la tarde|de la noche|am|pm))?)/)?.[1]
    ?? normalized.match(/\b(?:el que|la que)\s+esta\s+(a\s+las?\s+.+)$/)?.[1]
  return candidate ? clock(`a las ${candidate.replace(/^a\s+las?\s+/, '')}`) : undefined
}

function mentionedClocks(value: string) {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-MX')
  const matches = normalized.match(/\b(?:a\s+las?|a\s+la)\s+(?:\d{1,2}(?::\d{2})?|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?:\s+y\s+(?:media|cuarto))?(?:\s+(?:am|pm|de la manana|por la manana|de la tarde|por la tarde|de la noche|por la noche))?/g) ?? []
  return matches.map((match) => clock(match)).filter((value): value is string => Boolean(value))
}

function duration(value: string) {
  const numeric = value.match(/\b(\d+(?:\.\d+)?)\s*(horas?|hrs?|minutos?|mins?)\b/)
  const word = value.match(/\b(una|un|dos|tres|cuatro|cinco|seis)\s+horas?\b/)
  const amount = numeric ? Number(numeric[1]) : word ? numbers[word[1]] : undefined
  if (!amount) return undefined
  return /min/.test(numeric?.[2] ?? '') ? Math.round(amount) : Math.round(amount * 60)
}

function ordinal(value: string) {
  if (/\b(ahi|alli|ese espacio|esa opcion)\b/.test(value)) return 1
  if (/\b(primer[oa]?|uno)\b/.test(value)) return 1
  if (/\b(segund[oa]|dos)\b/.test(value)) return 2
  if (/\b(tercer[oa]?|tres)\b/.test(value)) return 3
  return undefined
}

function changedTitle(value: string) {
  const renamedEvent = value.match(/\b(?:renombra(?:lo)?|renombrar)\s+(?:el\s+)?(?:evento|reunión|reunion|cita|tarea)\s+(?:llamad[oa]\s+)?(.+?)\s+(?:a|por)\s+(.+)$/i)
  const named = value.match(/\bcambia(?:le)?\s+(?:el\s+)?(?:título|titulo|nombre)\s+(?:del|de la)?\s*(?:evento|reunión|reunion|cita|tarea)?\s+(?:llamad[oa]\s+)?(.+?)\s+(?:a|por)\s+(.+)$/i)
  const direct = value.match(/\b(?:c[aá]mbia(?:le)?|cambiar|renombra(?:lo)?|renombrar|ponle)\s+(?:el\s+)?(?:título|titulo|nombre)\s+(?:a\s+)?(.+)$/i)
  return (renamedEvent?.[2] ?? named?.[2] ?? direct?.[1])?.trim().replace(/[.?!]+$/,'')
}

function workspaceName(value: string) {
  return value.match(/\bworkspace\s+(?:de\s+)?([\p{L}0-9][\p{L}0-9 ._-]*?)(?=\s+(?:hoy|mañana|manana|el\s+\d|a\s+las?|de\s+\d|con\s+el\s+t[ií]tulo|con\s+t[ií]tulo)|[,.?!]|$)/iu)?.[1]?.trim()
}

function targetTitle(value: string) {
  const clean = (candidate?: string) => candidate?.trim().replace(/^["“]|["”.,?!]+$/g, '').trim()
  const patterns = [
    /\b(?:renombra(?:lo)?|renombrar)\s+(?:el\s+)?(?:evento|reuni[oó]n|cita|tarea)\s+(?:llamad[oa]\s+)?([\p{L}0-9][\p{L}0-9 ._-]*?)\s+(?:a|por)\s+.+$/iu,
    /\bcambia(?:le)?\s+(?:el\s+)?(?:t[ií]tulo|nombre)\s+(?:del|de la)?\s*(?:evento|reuni[oó]n|cita|tarea)?\s+(?:llamad[oa]\s+)?([\p{L}0-9][\p{L}0-9 ._-]*?)\s+(?:a|por)\s+.+$/iu,
    /\b(?:evento|reuni[oó]n|cita|tarea)\s+(?:llamad[oa]\s+)([\p{L}0-9][\p{L}0-9 ._-]*?)(?=\s+(?:a\s+las?|para|que|una\s+hora|dos\s+horas|tres\s+horas|cuatro\s+horas)|[,.?!]|$)/iu,
    /\b(?:duraci[oó]n\s+del|duraci[oó]n\s+de\s+la)\s+(?:evento|reuni[oó]n|cita|tarea)\s+([\p{L}0-9][\p{L}0-9 ._-]*?)(?=\s+(?:a|de|para|que)\s+\d|[,.?!]|$)/iu,
    /\b(?:mueve|mover|cambia|cambiar|recorre|reprograma|elimina|borra|renombra)\s+(?:de\s+hora\s+|la\s+duraci[oó]n\s+de\s+)?(?:el|la)?\s*(?:evento|reuni[oó]n|cita|tarea)\s+([\p{L}0-9][\p{L}0-9 ._-]*?)(?=\s+(?:a\s+las?|a\s+la|para|que|una\s+hora|dos\s+horas|tres\s+horas|cuatro\s+horas)|[,.?!]|$)/iu,
  ]
  for (const pattern of patterns) {
    const candidate = clean(value.match(pattern)?.[1])
    if (candidate && !/^(?:en\s+)?mi\s+calendario$/i.test(candidate) && !/^que\s+tengo\b/i.test(candidate)) return candidate
  }
  return undefined
}

export function routeCalendarIntent(message: string): CalendarFastRoute {
  const normalized = normalizeVoiceText(message)
  const updating = /\b(mueve|mover|muevelo|cambia|cambiar|cambiale|renombra|renombralo|ponle|reprograma|recorre|recorrelo|recorrela|mejor)\b/.test(normalized)
  const changesDuration = updating && /\b(duracion|dure|termine|finalice|hasta)\b/.test(normalized)
  const parsedRange = extractCalendarTimeRange(message)
  // “Prueba 3 a 4 horas” is a title plus a requested duration, not 03:00–04:00.
  // A real replacement range never ends with a duration unit.
  const timeRange = changesDuration && /\b(?:a|para)\s+(?:\d{1,2}|una|dos|tres|cuatro|cinco|seis)\s*(?:horas?|hrs?|minutos?|mins?)\b/.test(normalized)
    ? undefined
    : parsedRange
  const explicitSourceTime = sourceClock(message)
  const clocks = mentionedClocks(message)
  const movementPair = updating && !changesDuration && clocks.length >= 2 ? clocks : undefined
  const newTitle = changedTitle(message)
  const entities = {
    normalized,
    time: movementPair?.at(-1) ?? (updating && !changesDuration && timeRange?.end ? timeRange.end : timeRange?.start ?? clock(message)),
    endTime: updating && !changesDuration ? undefined : timeRange?.end,
    sourceTime: explicitSourceTime ?? movementPair?.[0] ?? (updating && !changesDuration && timeRange?.end ? timeRange.start : undefined),
    durationMinutes: duration(normalized),
    // A stated source time is a stronger locator than the previous conversational
    // result. Zero deliberately suppresses the implicit "first previous result".
    ordinal: ordinal(normalized) ?? (explicitSourceTime ? 0 : undefined),
    relativeMinutes: /\b(una|un)\s+hora\b/.test(normalized) && /\b(antes|temprano|adelanta)\b/.test(normalized)
      ? -60
      : /\b(una|un)\s+hora\b/.test(normalized) && /\b(mueve|muevelo|recorre|despues|mas tarde)\b/.test(normalized) ? 60 : undefined,
    provider: /\bgoogle\b/.test(normalized) ? 'google' as const : undefined,
    newTitle,
    workspaceName: workspaceName(message),
    targetTitle: targetTitle(message),
    updateKind: changesDuration ? 'duration' as const : newTitle ? 'rename' as const : updating ? 'move' as const : undefined,
  }
  const base = { skill: 'calendar' as const, entities }
  if (/\b(?:busca(?:me)?|buscar)\s+(?:las\s+)?alternativas\b/.test(normalized)) return { ...base, intent:'find_available_slots', confidence:.99 }
  const createVerb = /\b(agrega|agregar|anade|anadir|agenda|agendar|programa|programar|crea|crear|crea(?:r+)?me|genera|generar|genera(?:r+)?me|pon)\b/
  if (/\b(elimina|eliminar|borra|borrar|cancela|cancelar|quitar|quitalo|eliminalo)\b/.test(normalized) && (/\b(evento|reunion|cita|calendario|agenda|lo|la)\b/.test(normalized) || /\b(quitalo|eliminalo)\b/.test(normalized))) return { ...base, intent:'delete_calendar_event', confidence:.97 }
  // An explicit creation request wins over conversational correction words such as
  // "no, mejor...". Otherwise a fresh task can be mistaken for an event update.
  if (createVerb.test(normalized) && /\b(tarea|trabajar|terminar|avanzar|enfoque)\b/.test(normalized) && !/\b(libre|disponible|espacio|hueco)\b/.test(normalized)) return { ...base, intent:'create_scheduled_task', confidence:.97 }
  if ((createVerb.test(normalized) || /\b(registra|registrar|reserva)\b/.test(normalized)) && /\b(reunion|evento|cita|dentista|llamada|calendario|agenda)\b/.test(normalized)) return { ...base, intent:'create_calendar_event', confidence:.96 }
  if (updating && (/\b(evento|reunion|cita|agenda|calendario|titulo|nombre|lo|la)\b/.test(normalized) || entities.time || entities.relativeMinutes)) return { ...base, intent:'update_calendar_event', confidence:.95 }
  if (/\b(libre|disponible|espacio|hueco)\b/.test(normalized)) return { ...base, intent:'find_available_slots', confidence:.98 }
  if (/\b(que sigue|que tengo despues|siguiente compromiso|proximo compromiso|compromiso mas proximo|despues que tengo)\b/.test(normalized)) return { ...base, intent:'get_next_commitment', confidence:.98 }
  if (/\b(?:cual|dime|busca|encuentra)\b/.test(normalized) && /\b(?:mas temprano|primero|primera)\b/.test(normalized) && /\b(evento|reunion|cita|tarea|compromiso)\b/.test(normalized)) return { ...base, intent:'get_next_commitment', confidence:.98 }
  if (/\b(busca|encuentra|cual|donde)\b/.test(normalized) && /\b(evento|reunion|cita|agenda|calendario)\b/.test(normalized)) return { ...base, intent:'find_calendar_event', confidence:.88 }
  if (/\bque (?:evento|eventos|reunion|reuniones|cita|citas|tarea|tareas) tengo\b/.test(normalized) || (/\b(que tengo|agenda|calendario|compromisos?|a que hora termino|como esta mi dia)\b/.test(normalized) && /\b(hoy|manana|semana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|despues)\b/.test(normalized))) return { ...base, intent:'list_calendar_items', confidence:.98 }
  return { ...base, intent:'unknown', confidence:0 }
}
