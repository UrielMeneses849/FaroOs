import { Database, LoaderCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '../components/common'
import { isFaroTauriRuntime } from '../core/platform/runtime'
import { useAuth } from '../hooks/auth'
import {
  localDataMigrationService,
  localDataNeedsMigration,
  type LocalMigrationReport,
} from '../services/localDataMigrationService'
import { useFaroStore } from '../store'
import {
  LocalMigrationContext,
  type LocalMigrationState,
} from './LocalMigrationContext'

export function LocalMigrationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const isDesktop = isFaroTauriRuntime()
  const [state, setState] = useState<LocalMigrationState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<LocalMigrationReport | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    if (!user) return

    // Desktop is not a browser-local-data migration target. It signs in to
    // the same Supabase project/RLS identity and hydrates from that backend;
    // attempting to replay the empty WebView store can incorrectly block the
    // desktop app after an otherwise successful login.
    if (isDesktop) {
      return
    }

    let active = true

    const migrate = async () => {
      const data = useFaroStore.getState()
      const existingReport = localDataMigrationService.getReport(user.id)
      if (!localDataNeedsMigration(data) && existingReport) {
        setReport(existingReport)
        setState('ready')
        setError(null)
        return
      }

      setState('migrating')
      setError(null)
      try {
        const result = await localDataMigrationService.migrate(data, user.id)
        if (!active) return
        useFaroStore.getState().replaceData(result.data)
        setReport(result.report)
        setState('ready')
      } catch (reason) {
        if (!active) return
        setState('error')
        setError(
          reason instanceof Error
            ? reason.message
            : 'No fue posible migrar tus datos locales.',
        )
      }
    }

    void migrate()
    return () => {
      active = false
    }
  }, [attempt, isDesktop, user])

  const effectiveState: LocalMigrationState = isDesktop && user ? 'ready' : state
  const effectiveError = isDesktop ? null : error
  const effectiveReport = isDesktop ? null : report

  const value = useMemo(
    () => ({
      state: user ? effectiveState : 'idle' as const,
      error: user ? effectiveError : null,
      report: user ? effectiveReport : null,
      retry,
    }),
    [effectiveError, effectiveReport, effectiveState, retry, user],
  )

  if (user && (effectiveState === 'idle' || effectiveState === 'migrating')) {
    return (
      <main className="migration-screen" role="status" aria-live="polite">
        <div className="migration-screen__icon"><Database aria-hidden="true" /></div>
        <LoaderCircle className="spin" aria-hidden="true" />
        <h1>Preparando tu nueva base</h1>
        <p>Migrando tus datos locales de forma segura…</p>
      </main>
    )
  }

  if (user && effectiveState === 'error') {
    return (
      <main className="migration-screen" role="alert">
        <div className="migration-screen__icon migration-screen__icon--error">
          <Database aria-hidden="true" />
        </div>
        <h1>La migración quedó pendiente</h1>
        <p>{effectiveError} Tus datos siguen seguros en este dispositivo.</p>
        <Button icon={<RefreshCw size={16} />} onClick={retry}>Reintentar</Button>
      </main>
    )
  }

  return (
    <LocalMigrationContext.Provider value={value}>
      {children}
    </LocalMigrationContext.Provider>
  )
}
