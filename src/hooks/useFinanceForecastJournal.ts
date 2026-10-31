import { useEffect, useState } from 'react'
import type { FinanceData } from '../features/finance/financeTypes'
import { buildFinanceDecisionReport } from '../services/financeDecisionTools'
import { captureFinanceForecastJournal, hasFinanceForecastSnapshotForWeek, loadFinanceForecastJournal, type FinanceForecastJournalState } from '../services/financeForecastJournal'

const emptyJournal: FinanceForecastJournalState = { status: 'ready', entries: [] }

/** Capture the first real 90-day forecast viewed each week, entirely on device. */
export function useFinanceForecastJournal(data: FinanceData, userId: string | undefined, loading: boolean, error: string | null, simulated: boolean) {
  const [snapshot, setSnapshot] = useState<{ userId?: string; journal: FinanceForecastJournalState }>({ journal: emptyJournal })
  useEffect(() => {
    let cancelled = false
    let journal = userId ? loadFinanceForecastJournal(userId) : emptyJournal
    if (userId && journal.status === 'ready' && !loading && !error && !simulated && data.accounts.length && !data.debtPlanError
      && !hasFinanceForecastSnapshotForWeek(journal.entries)) {
      try {
        journal = captureFinanceForecastJournal(userId, buildFinanceDecisionReport(data))
      } catch {
        journal = { ...journal, message: 'No se pudo calcular la lectura semanal. El historial guardado se conserva.' }
      }
    }
    queueMicrotask(() => { if (!cancelled) setSnapshot({ userId, journal }) })
    return () => { cancelled = true }
  }, [data, error, loading, simulated, userId])
  return snapshot.userId === userId ? snapshot.journal : emptyJournal
}
