import { useCallback, useEffect, useState } from 'react'
import { journalRepository } from '../repositories/journalRepository'
import type { JournalEntry } from '../types'
import { useAuth } from './auth'

export function useJournal() {
  const { user } = useAuth()
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const refresh = useCallback(async () => {
    if (!user) return
    setLoading(true); setError(undefined)
    try { setEntries(await journalRepository.list(user.id)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo cargar el diario.') }
    finally { setLoading(false) }
  }, [user])
  useEffect(() => { queueMicrotask(() => void refresh()) }, [refresh])
  const save = async (entry: JournalEntry) => {
    if (!user) return
    const saved = await journalRepository.save(entry, user.id)
    setEntries((current) => [saved, ...current.filter((item) => item.id !== saved.id)]
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)))
    return saved
  }
  const remove = async (id: string) => {
    if (!user) return
    await journalRepository.remove(id, user.id)
    setEntries((current) => current.filter((item) => item.id !== id))
  }
  return { entries, loading, error, refresh, save, remove }
}
