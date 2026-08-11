export interface GoogleErrorDetails {
  status: number
  reason: string
  message: string
}

export const googleReadOnlyScopes = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const

export function calendarAppUrl(appUrl: string, result: 'connected' | 'error', reason?: string) {
  const normalizedBase = appUrl.endsWith('/') ? appUrl : `${appUrl}/`
  const url = new URL('calendar', normalizedBase)
  url.searchParams.set('googleCalendar', result)
  if (reason) url.searchParams.set('reason', reason)
  return url
}

export function googleEventsUrl(calendarId: string, timeMin: Date, timeMax: Date) {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    timeZone: 'America/Mexico_City',
    maxResults: '2500',
  })
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`
}

export function googleErrorDetails(status: number, payload: unknown): GoogleErrorDetails {
  const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const error = value.error && typeof value.error === 'object' ? value.error as Record<string, unknown> : {}
  const errors = Array.isArray(error.errors) ? error.errors : []
  const first = errors[0] && typeof errors[0] === 'object' ? errors[0] as Record<string, unknown> : {}
  return {
    status,
    reason: String(first.reason ?? error.status ?? error.code ?? 'unknown'),
    message: String(error.message ?? 'Google Calendar no respondió correctamente.'),
  }
}

export function maskCalendarId(calendarId: string | null | undefined) {
  if (!calendarId) return null
  if (calendarId.length < 7) return '***'
  return `${calendarId.slice(0, 3)}…${calendarId.slice(-3)}`
}
