import { addDays, endOfDay, isValid, parseISO } from 'date-fns'
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
  return items.filter((item) => {
    const start = parseISO(item.start)
    return isValid(start)
      && (item.sourceType === 'task' || item.sourceType === 'event')
      && !item.allDay
      && !['done', 'completed', 'cancelled'].includes(item.status)
      && start >= now
      && start <= end
  }).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 5)
}

export function weightRegistrationIsStale(lastDate: string | undefined, today: string) {
  if (!lastDate) return true
  const age = Math.floor((parseISO(today).getTime() - parseISO(lastDate.slice(0, 10)).getTime()) / 86_400_000)
  return age >= 2
}
