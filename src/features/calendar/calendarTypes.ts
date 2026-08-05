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
  source?: 'faro' | 'google'
  readOnly?: boolean
  externalId?: string
  calendarId?: string
  calendarName?: string
  entryKind?: 'event' | 'focus'
  description?: string
  linkedTaskId?: string
}

export interface GoogleCalendarConnection {
  connected: boolean
  status: 'disconnected' | 'needs_calendar' | 'active' | 'reconnect_required'
  accountEmail?: string | null
  calendarId?: string | null
  calendarName?: string | null
  connectedAt?: string | null
  lastSyncedAt?: string | null
}

export interface GoogleCalendarChoice { id: string; name: string; primary: boolean; accessRole: string }

export interface GoogleCalendarEvent {
  id: string
  summary?: string
  status?: string
  start?: { date?: string; dateTime?: string; timeZone?: string }
  end?: { date?: string; dateTime?: string; timeZone?: string }
}

export interface CalendarData {
  items: CalendarItem[]
  timezone: string
  omittedCount: number
}
