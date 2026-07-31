import { useCallback, useEffect, useState } from 'react'
import { healthRepository } from '../repositories/healthRepository'
import { useFaroStore } from '../store'
import type { HealthLog } from '../types'
import { useAuth } from './auth'

const isRealLog = (log: HealthLog) => !/^health-\d+$/.test(log.id)
const sortLogs = (logs: HealthLog[]) => [...logs].sort((a, b) =>
  b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt))

export function useHealthRecords() {
  const { user } = useAuth()
  const localLogs = useFaroStore((state) => state.healthLogs)
  const [logs, setLogs] = useState<HealthLog[]>(() => sortLogs(localLogs.filter(isRealLog)))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const replaceLocalBackup = useCallback((next: HealthLog[]) => {
    useFaroStore.setState({ healthLogs: sortLogs(next) })
  }, [])

  const refresh = useCallback(async () => {
    if (!user) { setLoading(false); return }
    setLoading(true); setError(undefined)
    try {
      const remote = await healthRepository.list(user.id)
      const remoteIds = new Set(remote.map((item) => item.id))
      const pendingLocal = useFaroStore.getState().healthLogs.filter((item) => isRealLog(item) && !remoteIds.has(item.id))
      await healthRepository.saveMissing(pendingLocal, user.id)
      const synchronized = pendingLocal.length ? await healthRepository.list(user.id) : remote
      setLogs(sortLogs(synchronized))
      replaceLocalBackup(synchronized)
    } catch (reason) {
      const fallback = sortLogs(useFaroStore.getState().healthLogs.filter(isRealLog))
      setLogs(fallback)
      setError(reason instanceof Error ? reason.message : 'No se pudieron sincronizar tus registros de salud.')
    } finally {
      setLoading(false)
    }
  }, [replaceLocalBackup, user])

  useEffect(() => { queueMicrotask(() => void refresh()) }, [refresh])

  const save = async (log: HealthLog) => {
    if (!user) throw new Error('No hay una sesión activa.')
    const saved = await healthRepository.save(log, user.id)
    const next = sortLogs([saved, ...logs.filter((item) => item.id !== saved.id)])
    setLogs(next); replaceLocalBackup(next); setError(undefined)
    return saved
  }

  const remove = async (id: string) => {
    if (!user) throw new Error('No hay una sesión activa.')
    await healthRepository.remove(id, user.id)
    const next = logs.filter((item) => item.id !== id)
    setLogs(next); replaceLocalBackup(next); setError(undefined)
  }

  return { logs, loading, error, refresh, save, remove }
}
