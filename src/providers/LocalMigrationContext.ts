import { createContext } from 'react'
import type { LocalMigrationReport } from '../services/localDataMigrationService'

export type LocalMigrationState = 'idle' | 'migrating' | 'ready' | 'error'

export interface LocalMigrationContextValue {
  state: LocalMigrationState
  error: string | null
  report: LocalMigrationReport | null
  retry: () => void
}

export const LocalMigrationContext =
  createContext<LocalMigrationContextValue | null>(null)
