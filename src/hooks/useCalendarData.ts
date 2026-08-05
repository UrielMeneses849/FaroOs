import { useCallback, useEffect, useState } from 'react'
import { calendarRepository } from '../repositories/calendarRepository'
import type { CalendarData, GoogleCalendarChoice, GoogleCalendarConnection } from '../features/calendar/calendarTypes'
import { useAuth } from './auth'
import { normalizeTimeZone } from '../lib/calendarDates'
import { mergeExternalCalendarItems, mergePlanningCalendarItems, normalizeCalendarData, normalizeGoogleCalendarEvents } from '../services/calendarService'
import { googleCalendarService } from '../services/googleCalendarService'
import { useFaroStore } from '../store'

export function useCalendarData() {
  const { user } = useAuth()
  const tasks = useFaroStore((state) => state.tasks)
  const projects = useFaroStore((state) => state.projects)
  const goals = useFaroStore((state) => state.goals)
  const [data, setData] = useState<CalendarData>({ items: [], timezone: normalizeTimeZone(undefined), omittedCount: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [googleConnection, setGoogleConnection] = useState<GoogleCalendarConnection>({ connected: false, status: 'disconnected' })
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarChoice[]>([])
  const [googleItems, setGoogleItems] = useState<CalendarData['items']>([])
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(null)
  const loadGoogle = useCallback(async (force = false) => {
    if (!user || user.is_anonymous) return
    setGoogleLoading(true); setGoogleError(null)
    try {
      const connection = await googleCalendarService.status()
      setGoogleConnection(connection)
      if (!connection.connected || connection.status === 'reconnect_required') { setGoogleItems([]); setGoogleCalendars([]); return }
      if (!connection.calendarId) { setGoogleCalendars(await googleCalendarService.listCalendars()); setGoogleItems([]); return }
      const now = new Date(); const from = new Date(now); const to = new Date(now)
      from.setDate(from.getDate() - 45); to.setDate(to.getDate() + 365)
      const result = await googleCalendarService.events(from.toISOString(), to.toISOString(), force)
      setGoogleItems(normalizeGoogleCalendarEvents(result.events, connection.calendarId, connection.calendarName ?? undefined))
      setGoogleConnection((current) => ({ ...current, lastSyncedAt: result.lastSyncedAt ?? current.lastSyncedAt, status: 'active' }))
    } catch (reason) {
      setGoogleError(reason instanceof Error ? reason.message : 'No pudimos sincronizar Google Calendar.')
    } finally { setGoogleLoading(false) }
  }, [user])
  const refreshData = useCallback(async (forceGoogle = false) => {
    if (!user) { setLoading(false); setError('No hay una sesión activa.'); return }
    setLoading(true); setError(null)
    try { const [calendarData] = await Promise.all([calendarRepository.getAll(user.id), loadGoogle(forceGoogle)]); setData(calendarData) }
    catch (reason) {
      if (import.meta.env.DEV) console.error('[FARO calendar] Falló la consulta del calendario.', reason)
      setError('No pudimos consultar tus datos en Supabase. Intenta nuevamente.')
    }
    finally { setLoading(false) }
  }, [loadGoogle, user])
  const refresh = useCallback(() => refreshData(false), [refreshData])
  useEffect(() => { queueMicrotask(() => void refresh()) }, [refresh])
  const localPlanningItems = normalizeCalendarData({ tasks, projects, goals })
  const synchronizedData: CalendarData = {
    ...data,
    items: mergeExternalCalendarItems(mergePlanningCalendarItems(data.items, localPlanningItems), googleItems),
  }
  const connectGoogle = useCallback(async () => { window.location.assign(await googleCalendarService.startAuthorization()) }, [])
  const selectGoogleCalendar = useCallback(async (calendarId: string) => { setGoogleLoading(true);setGoogleError(null);try{setGoogleConnection(await googleCalendarService.selectCalendar(calendarId));await loadGoogle(true)}catch(reason){setGoogleError(reason instanceof Error?reason.message:'No pudimos seleccionar el calendario.')}finally{setGoogleLoading(false)} }, [loadGoogle])
  const disconnectGoogle = useCallback(async () => { setGoogleLoading(true);setGoogleError(null);try{setGoogleConnection(await googleCalendarService.disconnect());setGoogleItems([]);setGoogleCalendars([])}catch(reason){setGoogleError(reason instanceof Error?reason.message:'No pudimos desconectar Google Calendar.')}finally{setGoogleLoading(false)} }, [])
  return { data: synchronizedData, loading, error, refresh, google: { connection:googleConnection, calendars:googleCalendars, loading:googleLoading, error:googleError, connect:connectGoogle, select:selectGoogleCalendar, sync:()=>loadGoogle(true), disconnect:disconnectGoogle } }
}
