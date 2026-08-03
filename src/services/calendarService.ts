import type { CalendarItem, CalendarSourceType } from '../features/calendar/calendarTypes'
import {
  calendarEnd,
  inclusiveAllDayEnd,
  normalizeDateOnly,
  normalizeTimestamp,
} from '../lib/calendarDates'
import type { Database } from '../types/database.types'
import type { CalendarEntry, Goal, Project, Task } from '../types'

type TaskRow = Database['public']['Tables']['tasks']['Row']
type ProjectRow = Database['public']['Tables']['projects']['Row']
type GoalRow = Database['public']['Tables']['goals']['Row']
type CalendarEntryRow = Database['public']['Tables']['calendar_entries']['Row']

interface CalendarSource {
  id: string
  sourceType: Exclude<CalendarSourceType, 'event'>
  title: string
  status: string
  archivedAt?: string | null
  workspaceId?: string | null
  priority?: CalendarItem['priority']
  projectId?: string | null
  goalId?: string | null
  dueAt?: unknown
  dueDate?: unknown
  startDate?: unknown
  endDate?: unknown
  targetDate?: unknown
  estimatedMinutes?: number | null
}

export interface CalendarNormalizationResult {
  items: CalendarItem[]
  omittedCount: number
}

function reportInvalidDate(source: CalendarSource, field: string, value: unknown) {
  if (!import.meta.env.DEV) return
  console.warn('[FARO calendar] Fecha inválida omitida.', {
    sourceType: source.sourceType,
    sourceId: source.id,
    field,
    value,
  })
}

function normalizeSource(source: CalendarSource): CalendarItem | null {
  if (source.archivedAt) return null

  if (source.sourceType === 'task') {
    const timestamp = normalizeTimestamp(source.dueAt)
    const dateOnly = normalizeDateOnly(source.dueDate)
    if (source.dueAt != null && source.dueAt !== '' && !timestamp) {
      reportInvalidDate(source, 'dueAt', source.dueAt)
    }
    if (source.dueDate != null && source.dueDate !== '' && !dateOnly) {
      reportInvalidDate(source, 'dueDate', source.dueDate)
    }
    const start = timestamp ?? dateOnly
    if (!start) return null
    return {
      id: `task:${source.id}`,
      sourceType: 'task',
      sourceId: source.id,
      title: source.title,
      start,
      end: timestamp ? calendarEnd(timestamp, source.estimatedMinutes ?? undefined) : undefined,
      allDay: !timestamp,
      workspaceId: source.workspaceId ?? undefined,
      status: source.status,
      priority: source.priority,
      projectId: source.projectId ?? undefined,
      goalId: source.goalId ?? undefined,
      editable: true,
    }
  }

  if (source.sourceType === 'project') {
    const startDate = normalizeDateOnly(source.startDate)
    const endDate = normalizeDateOnly(source.endDate)
    if (source.startDate != null && source.startDate !== '' && !startDate) {
      reportInvalidDate(source, 'startDate', source.startDate)
    }
    if (source.endDate != null && source.endDate !== '' && !endDate) {
      reportInvalidDate(source, 'endDate', source.endDate)
    }
    if (!startDate && !endDate) return null

    // An inverted range is never passed to FullCalendar. The target remains useful
    // as a one-day milestone while the source data is corrected.
    const inverted = Boolean(startDate && endDate && endDate < startDate)
    if (inverted) reportInvalidDate(source, 'dateRange', `${startDate}..${endDate}`)
    const start = inverted ? endDate! : (startDate ?? endDate!)
    const end = !inverted && endDate ? inclusiveAllDayEnd(endDate) : undefined
    return {
      id: `project:${source.id}`,
      sourceType: 'project',
      sourceId: source.id,
      title: source.title,
      start,
      end,
      allDay: true,
      workspaceId: source.workspaceId ?? undefined,
      status: source.status,
      priority: source.priority,
      goalId: source.goalId ?? undefined,
      editable: false,
    }
  }

  const targetDate = normalizeDateOnly(source.targetDate)
  if (source.targetDate != null && source.targetDate !== '' && !targetDate) {
    reportInvalidDate(source, 'targetDate', source.targetDate)
  }
  if (!targetDate) return null
  return {
    id: `goal:${source.id}`,
    sourceType: 'goal',
    sourceId: source.id,
    title: source.title,
    start: targetDate,
    allDay: true,
    workspaceId: source.workspaceId ?? undefined,
    status: source.status,
    editable: false,
  }
}

function normalizeSources(sources: CalendarSource[]): CalendarNormalizationResult {
  const items: CalendarItem[] = []
  let omittedCount = 0
  for (const source of sources) {
    const item = normalizeSource(source)
    if (item) items.push(item)
    else if (!source.archivedAt) omittedCount += 1
  }
  return { items, omittedCount }
}

function normalizedEntry(entry: CalendarEntry): CalendarItem {
  return {
    id: `event:${entry.id}`,
    sourceType: 'event',
    sourceId: entry.id,
    title: entry.title,
    description: entry.description,
    start: entry.startsAt,
    end: entry.endsAt,
    allDay: entry.allDay,
    workspaceId: entry.workspaceId,
    linkedTaskId: entry.linkedTaskId,
    entryKind: entry.kind,
    status: 'scheduled',
    editable: true,
  }
}

export function normalizeCalendarDataWithReport(input: {
  tasks: Task[]
  projects: Project[]
  goals: Goal[]
}): CalendarNormalizationResult {
  return normalizeSources([
    ...input.tasks.map((task): CalendarSource => ({ ...task, sourceType: 'task' })),
    ...input.projects.map((project): CalendarSource => ({ ...project, sourceType: 'project' })),
    ...input.goals.map((goal): CalendarSource => ({ ...goal, sourceType: 'goal' })),
  ])
}

export function normalizeCalendarData(input: {
  tasks: Task[]
  projects: Project[]
  goals: Goal[]
}): CalendarItem[] {
  return normalizeCalendarDataWithReport(input).items
}

export function mergePlanningCalendarItems(remote: CalendarItem[], local: CalendarItem[]) {
  const localIds = new Set(local.map((item) => item.id))
  return [...remote.filter((item) => item.sourceType === 'event' || !localIds.has(item.id)), ...local]
}

export function normalizeCalendarRows(input: {
  tasks: TaskRow[]
  projects: ProjectRow[]
  goals: GoalRow[]
  entries?: CalendarEntryRow[]
}): CalendarNormalizationResult {
  const normalized = normalizeSources([
    ...input.tasks.map((row): CalendarSource => ({
      id: row.id,
      sourceType: 'task',
      title: row.title,
      status: row.status,
      archivedAt: row.archived_at,
      workspaceId: row.workspace_id,
      priority: row.priority,
      projectId: row.project_id,
      goalId: row.goal_id,
      dueAt: row.due_at?.includes('T') ? row.due_at : undefined,
      dueDate: row.due_at?.includes('T') ? undefined : row.due_at,
      estimatedMinutes: row.estimated_minutes,
    })),
    ...input.projects.map((row): CalendarSource => ({
      id: row.id,
      sourceType: 'project',
      title: row.title,
      status: row.status,
      archivedAt: row.archived_at,
      workspaceId: row.workspace_id,
      priority: row.priority,
      goalId: row.goal_id,
      startDate: row.start_date,
      endDate: row.target_date,
    })),
    ...input.goals.map((row): CalendarSource => ({
      id: row.id,
      sourceType: 'goal',
      title: row.title,
      status: row.status,
      archivedAt: row.archived_at,
      workspaceId: row.workspace_id,
      targetDate: row.target_date,
    })),
  ])
  return {
    ...normalized,
    items: [
      ...normalized.items,
      ...(input.entries ?? []).map((row) => normalizedEntry({
        id: row.id,
        title: row.title,
        description: row.description ?? undefined,
        kind: row.kind as CalendarEntry['kind'],
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        allDay: row.all_day,
        workspaceId: row.workspace_id ?? undefined,
        linkedTaskId: row.linked_task_id ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    ],
  }
}
