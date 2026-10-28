import { format, isValid, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { timestampToLocalParts } from '../../lib/calendarDates'
import { upcoming48Hours } from '../../lib/dashboardMetrics'
import type { CalendarItem } from '../calendar/calendarTypes'
import type { Task } from '../../types'

/** Three actionable priorities; waiting and blocked work stays available in Backlog. */
export function dayPriorities(tasks: Task[], now = new Date()) {
  const today = format(now, 'yyyy-MM-dd')
  const priority = { critical: 0, high: 1, medium: 2, low: 3 }
  const due = (task: Task) => task.dueAt ? timestampToLocalParts(task.dueAt).date : task.dueDate
  return tasks.filter(task => !task.archivedAt && ['inbox', 'todo', 'doing', 'review', 'paused'].includes(task.status)
    && !(task.status === 'paused' && task.pausedUntil && task.pausedUntil > today)
    && (task.status === 'doing' || !due(task) || due(task)! <= today))
    .sort((a, b) => Number(!(due(a) && due(a)! <= today) && a.status !== 'doing') - Number(!(due(b) && due(b)! <= today) && b.status !== 'doing')
      || priority[a.priority] - priority[b.priority]
      || Number(b.status === 'doing') - Number(a.status === 'doing')
      || (due(a) ?? today).localeCompare(due(b) ?? today)
      || (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
      || a.title.localeCompare(b.title, 'es'))
    .slice(0, 3)
}

export function nextDayCommitment(items: CalendarItem[], now = new Date()) {
  // Keep ongoing timed events ahead of all-day entries when both are current.
  return upcoming48Hours(items.filter(item => !item.allDay), now)[0] ?? upcoming48Hours(items.filter(item => item.allDay), now)[0]
}

export function commitmentTiming(item: CalendarItem, now = new Date()) {
  if (item.allDay) return 'Todo el día'
  const start = parseISO(item.start)
  if (!isValid(start)) return 'Ver agenda'
  const minutes = Math.ceil((start.getTime() - now.getTime()) / 60_000)
  if (minutes <= 0) return 'En curso'
  if (minutes < 60) return `En ${minutes} min`
  if (minutes < 180) return `En ${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`
  return format(start, 'yyyy-MM-dd') === format(now, 'yyyy-MM-dd') ? 'Hoy' : format(start, 'EEEE, d MMM', { locale: es })
}
