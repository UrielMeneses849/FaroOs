import { addDays, format, startOfDay } from 'date-fns'
import { localDate, parseLocalDateOnly } from './calendarDates'

export function rollingWeekRange(focalDate: Date) {
  const mexicoDate = parseLocalDateOnly(localDate(focalDate)) ?? focalDate
  const start = addDays(startOfDay(mexicoDate), -1)
  return { start, end: addDays(start, 7) }
}

export function relativeDayLabel(date: Date, today = new Date()) {
  const key = format(date, 'yyyy-MM-dd')
  const mexicoToday = parseLocalDateOnly(localDate(today)) ?? today
  const todayKey = format(mexicoToday, 'yyyy-MM-dd')
  if (key === format(addDays(mexicoToday, -1), 'yyyy-MM-dd')) return 'AYER'
  if (key === todayKey) return 'HOY'
  if (key === format(addDays(mexicoToday, 1), 'yyyy-MM-dd')) return 'MAÑANA'
  return null
}
