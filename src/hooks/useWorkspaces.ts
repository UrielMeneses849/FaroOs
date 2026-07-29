import { useCallback, useEffect, useState } from 'react'
import { workspaceRepository } from '../repositories/workspaceRepository'
import type { Workspace } from '../types'
import { useAuth } from './auth'

export function useWorkspaces() {
  const { user } = useAuth()
  const [data, setData] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    if (!user) { setData([]); setLoading(false); setError('No hay una sesión activa.'); return }
    setLoading(true); setError(null)
    try { setData(await workspaceRepository.ensureDefaults(user.id)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible cargar los contextos.') }
    finally { setLoading(false) }
  }, [user])
  useEffect(() => { queueMicrotask(() => void refresh()) }, [refresh])
  const restoreDefaults = useCallback(async () => {
    if (!user) return
    setLoading(true); setError(null)
    try { setData(await workspaceRepository.restoreDefaults(user.id)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible restaurar los contextos.') }
    finally { setLoading(false) }
  }, [user])
  return { data, loading, error, refresh, restoreDefaults }
}
