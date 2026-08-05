import { useCallback, useEffect, useState } from 'react'
import { healthRepository } from '../repositories/healthRepository'
import { useFaroStore } from '../store'
import type { HealthLog } from '../types'
import { useAuth } from './auth'

// Only these four ids belonged to the original demo dataset. Do not discard
// legitimate legacy captures that may also use a health-<timestamp> id.
const isRealLog = (log: HealthLog) => !/^health-[1-4]$/.test(log.id)
const sortLogs = (logs: HealthLog[]) => [...logs].sort((a, b) =>
  b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt))
const errorMessage = (reason: unknown) => {
  if (reason instanceof Error) return reason.message
  if (reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string') return reason.message
  return 'No se pudieron sincronizar tus registros de salud.'
}

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
      const remoteById = new Map(remote.map((item) => [item.id, item]))
      const pendingLocal = useFaroStore.getState().healthLogs.filter((item) => {
        if (!isRealLog(item)) return false
        const remoteItem = remoteById.get(item.id)
        return !remoteItem || item.updatedAt > remoteItem.updatedAt
      })
      await healthRepository.saveMissing(pendingLocal, user.id)
      const synchronized = pendingLocal.length ? await healthRepository.list(user.id) : remote
      setLogs(sortLogs(synchronized))
      replaceLocalBackup(synchronized)
    } catch (reason) {
      const fallback = sortLogs(useFaroStore.getState().healthLogs.filter(isRealLog))
      setLogs(fallback)
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [replaceLocalBackup, user])

  useEffect(() => { queueMicrotask(() => void refresh()) }, [refresh])

  const save = async (log: HealthLog) => {
    if (!user) throw new Error('No hay una sesión activa.')
    const localNext = sortLogs([log, ...logs.filter((item) => item.id !== log.id)])
    setLogs(localNext); replaceLocalBackup(localNext); setError(undefined)
    try {
      const saved = await healthRepository.save(log, user.id)
      const synchronized = sortLogs([saved, ...localNext.filter((item) => item.id !== saved.id)])
      setLogs(synchronized); replaceLocalBackup(synchronized)
      return saved
    } catch (reason) {
      const message = errorMessage(reason)
      setError(message)
      // The local write is already durable. Let the form finish normally and
      // surface the cloud failure in the page-level retry notice.
      return log
    }
  }

  const remove = async (id: string) => {
    if (!user) throw new Error('No hay una sesión activa.')
    await healthRepository.remove(id, user.id)
    const next = logs.filter((item) => item.id !== id)
    setLogs(next); replaceLocalBackup(next); setError(undefined)
  }

  return { logs, loading, error, refresh, save, remove }
}
