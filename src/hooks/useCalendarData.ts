import { useCallback, useEffect, useState } from 'react'
import { calendarRepository } from '../repositories/calendarRepository'
import type { CalendarData } from '../features/calendar/calendarTypes'
import { useAuth } from './auth'
import { normalizeTimeZone } from '../lib/calendarDates'

export function useCalendarData() {
  const { user } = useAuth()
  const [data, setData] = useState<CalendarData>({ items: [], timezone: normalizeTimeZone(undefined), omittedCount: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    if (!user) { setLoading(false); setError('No hay una sesión activa.'); return }
    setLoading(true); setError(null)
    try { setData(await calendarRepository.getAll(user.id)) }
    catch (reason) {
      if (import.meta.env.DEV) console.error('[FARO calendar] Falló la consulta del calendario.', reason)
      setError('No pudimos consultar tus datos en Supabase. Intenta nuevamente.')
    }
    finally { setLoading(false) }
  }, [user])
  useEffect(() => { queueMicrotask(() => void refresh()) }, [refresh])
  return { data, loading, error, refresh }
}
