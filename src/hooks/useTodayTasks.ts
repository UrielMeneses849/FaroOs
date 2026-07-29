import { useCallback, useEffect, useMemo, useState } from 'react'
import { localDate } from '../lib/calendarDates'
import { taskRepository } from '../repositories/taskRepository'
import { useFaroStore } from '../store'
import type { Task } from '../types'
import { useAuth } from './auth'

export function useTodayTasks(includeCompleted = true) {
  const { user } = useAuth()
  const storeTasks = useFaroStore((state) => state.tasks)
  const [data, setData] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    if (!user) { setLoading(false); setError('No hay una sesión activa.'); return }
    setLoading(true); setError(null)
    try { setData(await taskRepository.getToday(user.id, localDate(), includeCompleted)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible cargar las tareas de hoy.') }
    finally { setLoading(false) }
  }, [includeCompleted, user])
  useEffect(() => { queueMicrotask(() => void refresh()) }, [refresh])
  const localData = useMemo(() => {
    const today = localDate()
    return storeTasks.filter((task) => task.dueDate && task.dueDate <= today
      && !task.archivedAt && (includeCompleted || task.status !== 'done'))
  }, [includeCompleted, storeTasks])
  return { data: localData.length ? localData : data, loading, error, refresh }
}
