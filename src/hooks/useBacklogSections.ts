import { useCallback, useEffect, useState } from 'react'
import { backlogSectionRepository } from '../repositories/backlogSectionRepository'
import type { BacklogSection } from '../types'
import { useAuth } from './auth'

export function useBacklogSections(workspaceId?: string) {
  const { user } = useAuth()
  const [data, setData] = useState<BacklogSection[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    if (!user || !workspaceId || workspaceId === 'all') {
      setData([]); setLoading(false); setError(null); return
    }
    setLoading(true); setError(null)
    try { setData(await backlogSectionRepository.list(workspaceId, user.id)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudieron cargar las secciones.') }
    finally { setLoading(false) }
  }, [user, workspaceId])

  useEffect(() => { queueMicrotask(() => void refresh()) }, [refresh])
  return { data, loading, error, refresh }
}
