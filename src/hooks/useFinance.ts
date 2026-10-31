import { useCallback, useEffect, useRef, useState } from 'react'
import type { FinanceData } from '../features/finance/financeTypes'
import { loadFinanceData } from '../repositories/financeRepositories'
import { useAuth } from './auth'

const emptyFinanceData: FinanceData = {
  accounts: [], categories: [], transactions: [], recurring: [],
  recurringOccurrences: [], budgets: [], goals: [], contributions: [],
  budgetClosures: [], savingsFundEntries: [], goalItems: [],
  liquidityPreference: { minimumOperatingBufferCents: 1_500_000 },
  liquiditySnapshots: [],
}

export function useFinance() {
  const { user } = useAuth()
  const [data, setData] = useState<FinanceData>(emptyFinanceData)
  const [loadedForUserId, setLoadedForUserId] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const lastRefresh = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++requestVersion.current
    if (!user) {
      setData(emptyFinanceData); setLoadedForUserId(undefined); setLoading(false); setError('No hay una sesión activa.'); return
    }
    setLoading(true); setError(null)
    try {
      const next = await loadFinanceData(user.id)
      if (request !== requestVersion.current) return
      setData(next); setLoadedForUserId(user.id); lastRefresh.current = Date.now()
    }
    catch (reason) { if (request === requestVersion.current) setError(reason instanceof Error ? reason.message : 'No fue posible cargar tus finanzas.') }
    finally { if (request === requestVersion.current) setLoading(false) }
  }, [user])
  const invalidateRequest = useCallback(() => { requestVersion.current++ }, [])
  useEffect(() => { queueMicrotask(() => void refresh()); return invalidateRequest }, [refresh, invalidateRequest])
  useEffect(() => {
    const handleFinanceUpdate = () => void refresh()
    window.addEventListener('faro:finance-updated', handleFinanceUpdate)
    return () => window.removeEventListener('faro:finance-updated', handleFinanceUpdate)
  }, [refresh])
  useEffect(() => {
    const updateVisibleData = () => {
      if (document.visibilityState === 'visible' && navigator.onLine && Date.now() - lastRefresh.current > 30_000) void refresh()
    }
    const reconnect = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', updateVisibleData)
    window.addEventListener('focus', updateVisibleData)
    window.addEventListener('online', reconnect)
    return () => {
      document.removeEventListener('visibilitychange', updateVisibleData)
      window.removeEventListener('focus', updateVisibleData)
      window.removeEventListener('online', reconnect)
    }
  }, [refresh])
  return { data, loadedForUserId, loading, error, refresh, user }
}
