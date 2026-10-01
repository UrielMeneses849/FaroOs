import { useCallback, useEffect, useRef, useState } from 'react'
import { calendarRepository } from '../repositories/calendarRepository'
import type { CalendarData, GoogleCalendarChoice, GoogleCalendarConnection } from '../features/calendar/calendarTypes'
import { useAuth } from './auth'
import { normalizeTimeZone } from '../lib/calendarDates'
import { mergeExternalCalendarItems, mergePlanningCalendarItems, normalizeCalendarData, normalizeGoogleCalendarEvents } from '../services/calendarService'
import { GoogleCalendarServiceError, googleCalendarService } from '../services/googleCalendarService'
import { useFaroStore } from '../store'
import { isFaroTauriRuntime } from '../core/platform/runtime'

const CALENDAR_CACHE_TTL_MS = 5 * 60 * 1000

interface CalendarCacheEntry {
  data: CalendarData
  cachedAt: number
}

interface GoogleCalendarCacheEntry {
  connection: GoogleCalendarConnection
  calendars: GoogleCalendarChoice[]
  items: CalendarData['items']
  cachedAt: number
}

const calendarCache = new Map<string, CalendarCacheEntry>()
const googleCalendarCache = new Map<string, GoogleCalendarCacheEntry>()

// Keep the last successful snapshot on this device as well as in memory.  A
// calendar is read far more often than it changes, and showing the snapshot
// immediately avoids a blank grid while Supabase/Google are checked in the
// background.  It expires quickly and is replaced by every successful sync.
function persistentKey(userId: string, kind: 'local' | 'google') { return `faro:calendar-cache:${kind}:${userId}` }
function readPersistent<T>(userId: string | undefined, kind: 'local' | 'google'): T | undefined {
  if (!userId) return undefined
  try {
    const value = JSON.parse(localStorage.getItem(persistentKey(userId, kind)) ?? 'null') as { cachedAt?: number } | null
    return value && typeof value.cachedAt === 'number' && Date.now() - value.cachedAt < CALENDAR_CACHE_TTL_MS ? value as T : undefined
  } catch { return undefined }
}
function writePersistent(userId: string, kind: 'local' | 'google', value: CalendarCacheEntry | GoogleCalendarCacheEntry) {
  try { localStorage.setItem(persistentKey(userId, kind), JSON.stringify(value)) } catch { /* cache is optional */ }
}
function setCalendarCache(userId: string, value: CalendarCacheEntry) { calendarCache.set(userId, value); writePersistent(userId, 'local', value) }
function setGoogleCalendarCache(userId: string, value: GoogleCalendarCacheEntry) { googleCalendarCache.set(userId, value); writePersistent(userId, 'google', value) }

function freshCalendarCache(userId?: string) {
  const entry = userId ? calendarCache.get(userId) ?? readPersistent<CalendarCacheEntry>(userId, 'local') : undefined
  if (entry && userId && !calendarCache.has(userId)) calendarCache.set(userId, entry)
  return entry && Date.now() - entry.cachedAt < CALENDAR_CACHE_TTL_MS ? entry : undefined
}

function freshGoogleCalendarCache(userId?: string) {
  const entry = userId ? googleCalendarCache.get(userId) ?? readPersistent<GoogleCalendarCacheEntry>(userId, 'google') : undefined
  if (entry && userId && !googleCalendarCache.has(userId)) googleCalendarCache.set(userId, entry)
  return entry && Date.now() - entry.cachedAt < CALENDAR_CACHE_TTL_MS ? entry : undefined
}

export function useCalendarData() {
  const { user } = useAuth()
  const tasks = useFaroStore((state) => state.tasks)
  const projects = useFaroStore((state) => state.projects)
  const goals = useFaroStore((state) => state.goals)
  const cachedCalendar = freshCalendarCache(user?.id)
  const cachedGoogle = freshGoogleCalendarCache(user?.id)
  const [data, setData] = useState<CalendarData>(() => cachedCalendar?.data ?? { items: [], timezone: normalizeTimeZone(undefined), omittedCount: 0 })
  const [loading, setLoading] = useState(() => !cachedCalendar)
  const [error, setError] = useState<string | null>(null)
  const [googleConnection, setGoogleConnection] = useState<GoogleCalendarConnection>(() => cachedGoogle?.connection ?? { connected: false, status: 'disconnected' })
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarChoice[]>(() => cachedGoogle?.calendars ?? [])
  const [googleItems, setGoogleItems] = useState<CalendarData['items']>(() => cachedGoogle?.items ?? [])
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(null)
  const desktopAuthorizationPending = useRef(false)
  const loadGoogle = useCallback(async (force = false) => {
    if (!user || user.is_anonymous) return
    const cached = !force ? freshGoogleCalendarCache(user.id) : undefined
    if (cached) {
      setGoogleConnection(cached.connection)
      setGoogleCalendars(cached.calendars)
      setGoogleItems(cached.items)
      setGoogleError(null)
      return
    }
    setGoogleLoading(true); setGoogleError(null)
    try {
      const connection = await googleCalendarService.status()
      if (!connection.connected || connection.status === 'reconnect_required') {
        setGoogleCalendarCache(user.id, { connection, calendars: [], items: [], cachedAt: Date.now() })
        setGoogleConnection(connection); setGoogleItems([]); setGoogleCalendars([])
        return
      }
      if (!connection.calendarId) {
        const calendars = await googleCalendarService.listCalendars()
        setGoogleCalendarCache(user.id, { connection, calendars, items: [], cachedAt: Date.now() })
        setGoogleConnection(connection); setGoogleCalendars(calendars); setGoogleItems([])
        return
      }
      const now = new Date(); const from = new Date(now); const to = new Date(now)
      from.setDate(from.getDate() - 45); to.setDate(to.getDate() + 365)
      const result = await googleCalendarService.events(from.toISOString(), to.toISOString(), force)
      const items = normalizeGoogleCalendarEvents(result.events, connection.calendarId, connection.calendarName ?? undefined)
      const activeConnection = { ...connection, lastSyncedAt: result.lastSyncedAt ?? connection.lastSyncedAt, status: 'active' as const }
      setGoogleCalendarCache(user.id, { connection: activeConnection, calendars: [], items, cachedAt: Date.now() })
      setGoogleItems(items); setGoogleCalendars([]); setGoogleConnection(activeConnection)
    } catch (reason) {
      if (reason instanceof GoogleCalendarServiceError && reason.code === 'google_token_refresh_failed') {
        setGoogleConnection((current) => ({ ...current, status: 'reconnect_required' }))
      }
      setGoogleError(reason instanceof Error ? reason.message : 'No pudimos sincronizar Google Calendar.')
    } finally { setGoogleLoading(false) }
  }, [user])
  const refreshData = useCallback(async (forceGoogle = false) => {
    if (!user) { setLoading(false); setError('No hay una sesión activa.'); return }
    const cached = !forceGoogle ? freshCalendarCache(user.id) : undefined
    if (cached) {
      setData(cached.data); setError(null); setLoading(false)
      await loadGoogle(false)
      return
    }
    setLoading(true); setError(null)
    try {
      const [calendarData] = await Promise.all([calendarRepository.getAll(user.id), loadGoogle(forceGoogle)])
      setCalendarCache(user.id, { data: calendarData, cachedAt: Date.now() })
      setData(calendarData)
    }
    catch (reason) {
      if (import.meta.env.DEV) console.error('[FARO calendar] Falló la consulta del calendario.', reason)
      setError('No pudimos consultar tus datos en Supabase. Intenta nuevamente.')
    }
    finally { setLoading(false) }
  }, [loadGoogle, user])
  const refresh = useCallback(() => refreshData(false), [refreshData])
  const forceRefresh = useCallback(() => refreshData(true), [refreshData])
  useEffect(() => { queueMicrotask(() => void refresh()) }, [refresh])
  useEffect(() => { const handle=()=>void refreshData(true);window.addEventListener('faro:calendar-updated',handle);return()=>window.removeEventListener('faro:calendar-updated',handle) }, [refreshData])
  useEffect(() => {
    if (!isFaroTauriRuntime()) return
    const resumeAuthorization = () => {
      if (!desktopAuthorizationPending.current || document.visibilityState === 'hidden') return
      desktopAuthorizationPending.current = false
      if (user) googleCalendarCache.delete(user.id)
      void loadGoogle(true)
    }
    window.addEventListener('focus', resumeAuthorization)
    document.addEventListener('visibilitychange', resumeAuthorization)
    return () => {
      window.removeEventListener('focus', resumeAuthorization)
      document.removeEventListener('visibilitychange', resumeAuthorization)
    }
  }, [loadGoogle, user])
  const localPlanningItems = normalizeCalendarData({ tasks, projects, goals })
  const synchronizedData: CalendarData = {
    ...data,
    items: mergeExternalCalendarItems(mergePlanningCalendarItems(data.items, localPlanningItems), googleItems),
  }
  const connectGoogle = useCallback(async () => {
    setGoogleLoading(true); setGoogleError(null)
    const desktop = isFaroTauriRuntime()
    try {
      const authorizationUrl = await googleCalendarService.startAuthorization(desktop ? 'desktop' : 'web')
      if (!desktop) {
        window.location.assign(authorizationUrl)
        return
      }
      desktopAuthorizationPending.current = true
      const { openDesktopExternalUrl } = await import('../desktop/desktopBridge')
      const result = await openDesktopExternalUrl(authorizationUrl)
      if (!result?.success) throw new Error(result?.message ?? 'No se pudo abrir Google en el navegador.')
    } catch (reason) {
      desktopAuthorizationPending.current = false
      setGoogleLoading(false)
      setGoogleError(reason instanceof Error ? reason.message : 'No se pudo iniciar la conexión con Google Calendar.')
    }
  }, [])
  const listGoogleCalendars = useCallback(async () => {
    setGoogleLoading(true); setGoogleError(null)
    try { setGoogleCalendars(await googleCalendarService.listCalendars()) }
    catch (reason) { setGoogleError(reason instanceof Error ? reason.message : 'No pudimos consultar tus calendarios.') }
    finally { setGoogleLoading(false) }
  }, [])
  const selectGoogleCalendar = useCallback(async (calendarId: string) => { setGoogleLoading(true);setGoogleError(null);try{const connection=await googleCalendarService.selectCalendar(calendarId);if(user)googleCalendarCache.delete(user.id);setGoogleConnection(connection);await loadGoogle(true)}catch(reason){setGoogleError(reason instanceof Error?reason.message:'No pudimos seleccionar el calendario.')}finally{setGoogleLoading(false)} }, [loadGoogle, user])
  const selectGoogleCalendars = useCallback(async (calendarIds: string[]) => { setGoogleLoading(true);setGoogleError(null);try{const connection=await googleCalendarService.selectCalendars(calendarIds);if(user)googleCalendarCache.delete(user.id);setGoogleConnection(connection);await loadGoogle(true)}catch(reason){setGoogleError(reason instanceof Error?reason.message:'No pudimos seleccionar los calendarios.')}finally{setGoogleLoading(false)} }, [loadGoogle, user])
  const disconnectGoogle = useCallback(async () => { setGoogleLoading(true);setGoogleError(null);try{const connection=await googleCalendarService.disconnect();if(user)setGoogleCalendarCache(user.id,{connection,calendars:[],items:[],cachedAt:Date.now()});setGoogleConnection(connection);setGoogleItems([]);setGoogleCalendars([])}catch(reason){setGoogleError(reason instanceof Error?reason.message:'No pudimos desconectar Google Calendar.')}finally{setGoogleLoading(false)} }, [user])
  return { data: synchronizedData, loading, error, refresh, forceRefresh, google: { connection:googleConnection, calendars:googleCalendars, loading:googleLoading, error:googleError, connect:connectGoogle, list:listGoogleCalendars, select:selectGoogleCalendar, selectMany:selectGoogleCalendars, sync:()=>loadGoogle(true), disconnect:disconnectGoogle } }
}
