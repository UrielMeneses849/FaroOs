import { addDays, addMinutes, format } from 'date-fns'

const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/
const timestampPattern = /^\d{4}-\d{2}-\d{2}T/
export const FARO_TIME_ZONE = 'America/Mexico_City'

function zonedParts(date: Date, timeZone = FARO_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

function timeZoneOffset(date: Date, timeZone = FARO_TIME_ZONE) {
  const part = zonedParts(date, timeZone)
  const wallTimeAsUtc = Date.UTC(
    Number(part.year), Number(part.month) - 1, Number(part.day),
    Number(part.hour), Number(part.minute), Number(part.second),
  )
  return wallTimeAsUtc - date.getTime()
}

export const isDateOnly = (value: unknown): value is string =>
  typeof value === 'string' && dateOnlyPattern.test(value)

export function parseLocalDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const match = dateOnlyPattern.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(year, month - 1, day, 12)
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
    ? parsed
    : null
}

export function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim() || !timestampPattern.test(value)) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function safeParseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  return parseLocalDateOnly(value) ?? parseTimestamp(value)
}

export const isValidDateValue = (value: unknown) => safeParseDate(value) !== null

export function safeToISOString(value: unknown): string | null {
  const parsed = safeParseDate(value)
  if (!parsed) return null
  try { return parsed.toISOString() } catch { return null }
}

export function normalizeDateOnly(value: unknown): string | null {
  const parsed = parseLocalDateOnly(value)
  return parsed ? format(parsed, 'yyyy-MM-dd') : null
}

export function normalizeTimestamp(value: unknown): string | null {
  const parsed = parseTimestamp(value)
  if (!parsed) return null
  try { return parsed.toISOString() } catch { return null }
}

export const formatLocalDateOnly = (value: unknown, timeZone = FARO_TIME_ZONE) => {
  const parsed = safeParseDate(value)
  if (!parsed) return null
  if (isDateOnly(value)) return value
  const parts = zonedParts(parsed, timeZone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

export const toSupabaseTimestamp = (value: unknown) => safeToISOString(value)
export const localDate = (date = new Date(), timeZone = FARO_TIME_ZONE) => {
  const parts = zonedParts(date, timeZone)
  return `${parts.year}-${parts.month}-${parts.day}`
}
export const localTime = (date = new Date(), timeZone = FARO_TIME_ZONE) => {
  const parts = zonedParts(date, timeZone)
  return `${parts.hour}:${parts.minute}`
}

export function localDateTimeToTimestamp(date: string, time: string, timeZone = FARO_TIME_ZONE) {
  const parsedDate = parseLocalDateOnly(date)
  if (!parsedDate || !/^\d{2}:\d{2}$/.test(time || '09:00')) {
    throw new Error('La fecha u hora no es válida.')
  }
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const intendedUtc = Date.UTC(year, month - 1, day, hour, minute)
  let instant = new Date(intendedUtc)
  // Resolve the selected wall-clock time in the explicit FARO timezone.
  instant = new Date(intendedUtc - timeZoneOffset(instant, timeZone))
  instant = new Date(intendedUtc - timeZoneOffset(instant, timeZone))
  return instant.toISOString()
}

export function timestampToLocalParts(timestamp?: string, timeZone = FARO_TIME_ZONE) {
  const date = parseTimestamp(timestamp)
  if (!date) return { date: '', time: '' }
  const parts = zonedParts(date, timeZone)
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

export function timestampToWallTime(timestamp?: string, timeZone = FARO_TIME_ZONE) {
  const parts = timestampToLocalParts(timestamp, timeZone)
  return parts.date && parts.time ? `${parts.date}T${parts.time}:00` : timestamp
}

export function calendarDateToTimestamp(date: Date, timeZone = FARO_TIME_ZONE) {
  return localDateTimeToTimestamp(format(date, 'yyyy-MM-dd'), format(date, 'HH:mm'), timeZone)
}

export function calendarEnd(start: unknown, minutes?: number): string | undefined {
  if (isDateOnly(start)) return undefined
  const parsed = parseTimestamp(start)
  if (!parsed) return undefined
  const safeMinutes = Number.isFinite(minutes) ? Math.max(15, minutes ?? 30) : 30
  return safeToISOString(addMinutes(parsed, safeMinutes)) ?? undefined
}

export function inclusiveAllDayEnd(date: unknown): string | undefined {
  const parsed = parseLocalDateOnly(date)
  return parsed ? format(addDays(parsed, 1), 'yyyy-MM-dd') : undefined
}

export const localDayBounds = (date = new Date()) => ({
  start: localDateTimeToTimestamp(localDate(date), '00:00'),
  end: localDateTimeToTimestamp(localDate(date), '23:59'),
})

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch { return false }
}

export function normalizeTimeZone(value: unknown) {
  return isValidTimeZone(value) ? value : FARO_TIME_ZONE
}
