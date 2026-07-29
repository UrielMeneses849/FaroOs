import { useCallback, useEffect, useState } from 'react'
import type { SprintData } from '../features/sprints/sprintTypes'
import { sprintRepository } from '../repositories/sprintRepository'
import { useAuth } from './auth'

const empty: SprintData = { sprints: [], outcomes: [], sprintTasks: [], reviews: [] }
export function useSprints() {
  const { user } = useAuth(); const [data, setData] = useState(empty); const [loading, setLoading] = useState(true); const [error, setError] = useState<string>()
  const refresh = useCallback(async () => { if (!user) return; setLoading(true); setError(undefined); try { setData(await sprintRepository.load(user.id)) } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los sprints.') } finally { setLoading(false) } }, [user])
  useEffect(() => { queueMicrotask(() => void refresh()) }, [refresh])
  return { data, loading, error, refresh, user }
}
