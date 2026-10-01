import { addDays, endOfDay, format, isValid, parseISO } from 'date-fns'
import type { CalendarItem } from '../features/calendar/calendarTypes'
import type { Task, Workspace } from '../types'

export function workspaceOpenLoad(tasks: Task[], workspaces: Workspace[], today: string) {
  return workspaces.filter((workspace) => workspace.isActive).map((workspace) => {
    const all = tasks.filter((task) => task.workspaceId === workspace.id && !task.archivedAt)
    const open = all.filter((task) => task.status !== 'done')
    const completed = all.filter((task) => task.status === 'done').length
    return {
      workspace,
      open: open.length,
      pending: open.filter((task) => task.status === 'todo' || task.status === 'inbox' || task.status === 'paused').length,
      doing: open.filter((task) => task.status === 'doing').length,
      overdue: open.filter((task) => Boolean(task.dueDate && task.dueDate < today)).length,
      completionPercent: all.length ? completed / all.length * 100 : 0,
    }
  })
}

export function upcoming48Hours(items: CalendarItem[], now = new Date()) {
  const end = endOfDay(addDays(now, 1))
  const today = format(now, 'yyyy-MM-dd')
  const tomorrow = format(addDays(now, 1), 'yyyy-MM-dd')
  return items.filter((item) => {
    const start = parseISO(item.start)
    if (!isValid(start) || !['task', 'event'].includes(item.sourceType) || ['done', 'completed', 'cancelled'].includes(item.status)) return false

    // Deadlines stay out of the agenda when they have no time, but all-day
    // calendar events are commitments and must stay visible on their dates.
    if (item.allDay) {
      if (item.sourceType !== 'event') return false
      const startsOn = item.start.slice(0, 10)
      const endsOn = item.end?.slice(0, 10)
      // Google supplies an exclusive end date for all-day ranges. A one-day
      // event without an end is still current on its start date.
      return startsOn <= tomorrow && (endsOn ? endsOn > today : startsOn >= today)
    }

    // Do not make an event disappear merely because it already started; keep
    // it through its end so the dashboard reflects the current commitment.
    if (item.sourceType === 'event' && item.end) {
      const eventEnd = parseISO(item.end)
      return isValid(eventEnd) && eventEnd >= now && start <= end
    }
    return start >= now && start <= end
  }).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 5)
}

export function weightRegistrationIsStale(lastDate: string | undefined, today: string) {
  if (!lastDate) return true
  const age = Math.floor((parseISO(today).getTime() - parseISO(lastDate.slice(0, 10)).getTime()) / 86_400_000)
  return age >= 2
}
