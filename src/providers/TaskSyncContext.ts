import { createContext } from 'react'

export type TaskSyncState = 'idle' | 'syncing' | 'ready' | 'error'

export interface TaskSyncContextValue {
  state: TaskSyncState
  error: string | null
  retry: () => void
}

export const TaskSyncContext = createContext<TaskSyncContextValue | null>(null)
