import { useCallback, useEffect, useState } from 'react'
import type { FinanceData } from '../features/finance/financeTypes'
import { loadFinanceData } from '../repositories/financeRepositories'
import { useAuth } from './auth'

const emptyFinanceData: FinanceData = {
  accounts: [], categories: [], transactions: [], recurring: [],
  recurringOccurrences: [], budgets: [], goals: [], contributions: [],
  budgetClosures: [], savingsFundEntries: [], goalItems: [],
}

export function useFinance() {
  const { user } = useAuth()
  const [data, setData] = useState<FinanceData>(emptyFinanceData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    if (!user) {
      setData(emptyFinanceData); setLoading(false); setError('No hay una sesión activa.'); return
    }
    setLoading(true); setError(null)
    try { setData(await loadFinanceData(user.id)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible cargar tus finanzas.') }
    finally { setLoading(false) }
  }, [user])
  useEffect(() => { queueMicrotask(() => void refresh()) }, [refresh])
  return { data, loading, error, refresh, user }
}
