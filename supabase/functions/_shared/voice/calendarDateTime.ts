import { normalizeVoiceText } from './financeFastPath.ts'

const months: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
}

const pad = (value: number) => String(value).padStart(2, '0')

export function addCalendarDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number)
  const value = new Date(Date.UTC(year, month - 1, day + days, 12))
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
}

export function calendarLocalDate(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function resolveExplicitCalendarDate(message: string, today: string) {
  const normalized = normalizeVoiceText(message)
  const monthNames = Object.keys(months).join('|')
  const match = normalized.match(new RegExp(`\\b(?:el\\s+)?(\\d{1,2})\\s+(?:de\\s+)?(${monthNames})(?:\\s+de\\s+(\\d{4}))?\\b`))
  if (!match) return undefined
  const day = Number(match[1])
  const month = months[match[2]]
  let year = match[3] ? Number(match[3]) : Number(today.slice(0, 4))
  const candidate = () => `${year}-${pad(month)}-${pad(day)}`
  const parsed = new Date(`${candidate()}T12:00:00Z`)
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) return undefined
  if (!match[3] && candidate() < today) year += 1
  return candidate()
}

type ParsedClock = { hour: number; minute: number; suffix?: string }

function parsedClock(hourValue: string, minuteValue?: string, suffixValue?: string): ParsedClock | undefined {
  let hour = Number(hourValue)
  const minute = minuteValue ? Number(minuteValue) : 0
  const suffix = suffixValue?.toLowerCase()
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return undefined
  const afternoon = suffix === 'pm' || suffix?.includes('tarde') || suffix?.includes('noche')
  const morning = suffix === 'am' || suffix?.includes('manana')
  if (afternoon && hour < 12) hour += 12
  if (morning && hour === 12) hour = 0
  return { hour, minute, suffix }
}

export function extractCalendarTimeRange(message: string) {
  const normalized = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-MX').replace(/[^a-z0-9:.,$ ]/g, ' ').replace(/\s+/g, ' ').trim()
  const period = String.raw`am|pm|de la manana|por la manana|de la tarde|por la tarde|de la noche|por la noche`
  const matches = [...normalized.matchAll(new RegExp(`(?:^|\\s)(?:de|desde)?\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(${period})?\\s*(?:a|hasta)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(${period})?\\b`, 'g'))]
  const match = matches.at(-1)
  if (!match) return undefined
  const start = parsedClock(match[1], match[2], match[3])
  const end = parsedClock(match[4], match[5], match[6])
  if (!start || !end) return undefined

  // In natural Spanish the period is commonly stated only once at the end:
  // “de 9 a 10 de la noche” means 21:00–22:00, not 09:00–22:00.
  if (!start.suffix && end.suffix) {
    const afternoon = end.suffix === 'pm' || end.suffix.includes('tarde') || end.suffix.includes('noche')
    const morning = end.suffix === 'am' || end.suffix.includes('manana')
    if (afternoon && start.hour < 12) start.hour += 12
    if (morning && start.hour === 12) start.hour = 0
  }

  // “de 9 a 6” normalmente expresa 09:00–18:00, no una duración negativa.
  if (!end.suffix && end.hour <= start.hour && end.hour <= 12) end.hour += 12
  if (!start.suffix && end.suffix === 'pm' && start.hour >= 1 && start.hour <= 7) start.hour += 12
  if (start.hour > 23 || end.hour > 23) return undefined
  return {
    start: `${pad(start.hour)}:${pad(start.minute)}`,
    end: `${pad(end.hour)}:${pad(end.minute)}`,
  }
}

export function zonedCalendarIso(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const intended = Date.UTC(year, month - 1, day, hour, minute)
  let instant = new Date(intended)
  for (let index = 0; index < 2; index += 1) {
    const parts = zonedParts(instant, timeZone)
    const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
    instant = new Date(intended - (wall - instant.getTime()))
  }
  return instant.toISOString()
}

function zonedParts(date: Date, timeZone: string) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]))
}
