import type { CalendarItem } from '../features/calendar/calendarTypes'
import type { Workspace } from '../types'

export interface CalendarRange { start: string; end: string }

const normalizedWorkspaceName = (name: string) => name.trim().toLocaleLowerCase('es').replace('portafolio', 'portfolio')

export function resolveCalendarWorkspaceId(item: CalendarItem, workspaces: Workspace[]) {
  if (item.workspaceId && workspaces.some((workspace) => workspace.id === item.workspaceId)) return item.workspaceId
  if (item.source !== 'google' || !item.calendarName) return undefined
  const calendarName = normalizedWorkspaceName(item.calendarName)
  return workspaces.find((workspace) => normalizedWorkspaceName(workspace.name) === calendarName)?.id
}

export function isCountableCalendarItem(item: CalendarItem) {
  if (item.allDay || item.sourceType === 'project' || item.sourceType === 'goal') return false
  if (item.sourceType === 'task') return !['done', 'completed', 'archived'].includes(item.status)
  return item.sourceType === 'event'
}

function overlapsRange(item: CalendarItem, range: CalendarRange) {
  const start = new Date(item.start).getTime()
  const end = new Date(item.end ?? item.start).getTime()
  const rangeStart = new Date(range.start).getTime()
  const rangeEnd = new Date(range.end).getTime()
  if (![start, end, rangeStart, rangeEnd].every(Number.isFinite)) return false
  return start < rangeEnd && Math.max(start, end) >= rangeStart
}

export function calendarItemsInRange(items: CalendarItem[], range: CalendarRange) {
  const unique = new Map<string, CalendarItem>()
  for (const item of items) {
    if (!isCountableCalendarItem(item) || !overlapsRange(item, range)) continue
    unique.set(item.id, item)
  }
  return [...unique.values()]
}

export function calendarWorkspaceCounts(items: CalendarItem[], workspaces: Workspace[]) {
  const byWorkspace = Object.fromEntries(workspaces.map((workspace) => [workspace.id, 0])) as Record<string, number>
  for (const item of items) {
    const workspaceId = resolveCalendarWorkspaceId(item, workspaces)
    if (workspaceId) byWorkspace[workspaceId] += 1
  }
  return { all: items.length, byWorkspace }
}
