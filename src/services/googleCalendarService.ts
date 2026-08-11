import { supabase } from '../lib/supabase/client'
import type { GoogleCalendarChoice, GoogleCalendarConnection, GoogleCalendarEvent } from '../features/calendar/calendarTypes'

interface GoogleFunctionErrorPayload {
  error?: string
  message?: string
  googleStatus?: number
  googleReason?: string
}
interface InvokeResult<T> { data: T | null; error: { message: string; context?: unknown } | null }
let eventCache: { key: string; value: GoogleCalendarEvent[]; lastSyncedAt?: string } | undefined
let pendingEvents: Promise<{ events: GoogleCalendarEvent[]; lastSyncedAt?: string }> | undefined

async function invoke<T>(functionName: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(functionName, { body }) as InvokeResult<T & GoogleFunctionErrorPayload>
  let errorPayload: GoogleFunctionErrorPayload | null = data?.error ? data : null
  const context = error?.context
  if (!errorPayload && context && typeof context === 'object' && 'json' in context && typeof context.json === 'function') {
    try { errorPayload = await context.json() as GoogleFunctionErrorPayload }
    catch { errorPayload = null }
  }
  if (error || !data || data.error) throw new Error(errorPayload?.message ?? error?.message ?? 'No se pudo consultar Google Calendar.')
  return data
}

export const googleCalendarService = {
  async status() {
    return (await invoke<{ connection: GoogleCalendarConnection }>('google-calendar-api', { action: 'status' })).connection
  },
  async startAuthorization() {
    return (await invoke<{ authorizationUrl: string }>('google-calendar-auth-start', {})).authorizationUrl
  },
  async listCalendars() {
    return (await invoke<{ calendars: GoogleCalendarChoice[] }>('google-calendar-api', { action: 'list' })).calendars
  },
  async selectCalendar(calendarId: string) {
    eventCache = undefined
    return (await invoke<{ connection: GoogleCalendarConnection }>('google-calendar-api', { action: 'select', calendarId })).connection
  },
  async events(timeMin: string, timeMax: string, force = false) {
    const key = `${timeMin}:${timeMax}`
    if (!force && eventCache?.key === key) return { events: eventCache.value, lastSyncedAt: eventCache.lastSyncedAt }
    if (!force && pendingEvents) return pendingEvents
    pendingEvents = invoke<{ events: GoogleCalendarEvent[]; lastSyncedAt?: string }>('google-calendar-api', { action: 'events', timeMin, timeMax })
      .then((result) => {
        eventCache = { key, value: result.events, lastSyncedAt: result.lastSyncedAt }
        return result
      }).finally(() => { pendingEvents = undefined })
    return pendingEvents
  },
  async freeBusy(timeMin:string,timeMax:string,timeZone:string){
    return invoke<{busy:Array<{start:string;end:string}>}>('google-calendar-api',{action:'freebusy',timeMin,timeMax,timeZone})
  },
  async getEvent(eventId:string){return (await invoke<{event:GoogleCalendarEvent}>('google-calendar-api',{action:'get',eventId})).event},
  async disconnect() {
    eventCache = undefined
    return (await invoke<{ connection: GoogleCalendarConnection }>('google-calendar-api', { action: 'disconnect' })).connection
  },
}
