import { useCallback, useEffect, useState } from 'react'
import { calendarRepository } from '../repositories/calendarRepository'
import type { CalendarData } from '../features/calendar/calendarTypes'
import { useAuth } from './auth'
import { normalizeTimeZone } from '../lib/calendarDates'
import { mergePlanningCalendarItems, normalizeCalendarData } from '../services/calendarService'
import { useFaroStore } from '../store'

export function useCalendarData() {
  const { user } = useAuth()
  const tasks = useFaroStore((state) => state.tasks)
  const projects = useFaroStore((state) => state.projects)
  const goals = useFaroStore((state) => state.goals)
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
  const localPlanningItems = normalizeCalendarData({ tasks, projects, goals })
  const synchronizedData: CalendarData = {
    ...data,
    items: mergePlanningCalendarItems(data.items, localPlanningItems),
  }
  return { data: synchronizedData, loading, error, refresh }
}
