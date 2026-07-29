import { createContext } from 'react'

export type GoalSyncState = 'idle' | 'syncing' | 'ready' | 'error'

export interface GoalSyncContextValue {
  state: GoalSyncState
  error: string | null
  retry: () => void
}

export const GoalSyncContext = createContext<GoalSyncContextValue | null>(null)
