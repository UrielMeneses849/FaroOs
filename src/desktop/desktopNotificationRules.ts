import type { CalendarItem } from '../features/calendar/calendarTypes'
import type { Task } from '../types'

export type DesktopNotification = { key: string; title: string; body: string; route: '/finance' | '/calendar' | '/backlog'; calendarItemId?: string }

/** The wording is kept deterministic because it is sent to the native macOS
 * speech engine; it never goes through a model. */
export function calendarAnnouncement(title: string, workspaceName?: string, leadMinutes = 10) {
  return `En ${leadMinutes} minutos tienes ${title} para ${workspaceName ?? 'tu calendario'}.`
}

export function desktopNotificationCandidates({ now, calendarItems, tasks, calendarLeadMinutes }: { now: Date; calendarItems: CalendarItem[]; tasks: Task[]; calendarLeadMinutes: number }): DesktopNotification[] {
  const candidates: DesktopNotification[] = []
  const leadMs = calendarLeadMinutes * 60_000
  for (const item of calendarItems) {
    if (item.allDay) continue
    const startsAt = new Date(item.start).getTime()
    const offset = startsAt - now.getTime()
    if (offset > 0 && offset <= leadMs) candidates.push({ key: `calendar:${item.id}:${now.toISOString().slice(0, 13)}`, title: 'Próximo en FARO', body: `${item.title} empieza pronto.`, route: '/calendar', calendarItemId: item.id })
  }
  const today = now.toISOString().slice(0, 10)
  for (const task of tasks) {
    if (!task.dueDate || task.status === 'done' || task.dueDate >= today) continue
    candidates.push({ key: `backlog:${task.id}:${today}`, title: 'Tarea vencida', body: task.title, route: '/backlog' })
  }
  return candidates
}

/** Finance rules call this only after the existing finance domain reports a real alert. */
export function financeRiskNotification(id: string, message: string, day: string): DesktopNotification {
  return { key: `finance:${id}:${day}`, title: 'Atención financiera', body: message, route: '/finance' }
}
