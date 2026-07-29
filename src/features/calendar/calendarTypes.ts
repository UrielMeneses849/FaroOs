import type { Priority } from '../../types'

export type CalendarSourceType = 'task' | 'project' | 'goal' | 'event'

export interface CalendarItem {
  id: string
  sourceType: CalendarSourceType
  sourceId: string
  title: string
  start: string
  end?: string
  allDay: boolean
  workspaceId?: string
  status: string
  priority?: Priority
  projectId?: string
  goalId?: string
  editable: boolean
}

export interface CalendarData {
  items: CalendarItem[]
  timezone: string
  omittedCount: number
}
