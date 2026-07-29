import { createContext } from 'react'

export type ProjectSyncState = 'idle' | 'syncing' | 'ready' | 'error'

export interface ProjectSyncContextValue {
  state: ProjectSyncState
  error: string | null
  retry: () => void
}

export const ProjectSyncContext = createContext<ProjectSyncContextValue | null>(null)
