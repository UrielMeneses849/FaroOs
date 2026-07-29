import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './auth'

export function useRepositoryList<T>(loader: (userId: string) => Promise<T[]>) {
  const { user } = useAuth()
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const refresh = useCallback(async () => {
    if (!user) return
    setLoading(true); setError(undefined)
    try { setData(await loader(user.id)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible sincronizar los datos.') }
    finally { setLoading(false) }
  }, [loader, user])
  useEffect(() => { queueMicrotask(() => void refresh()) }, [refresh])
  return { data, setData, loading, error, refresh, user }
}
