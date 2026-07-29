import { useContext } from 'react'
import { ProjectSyncContext } from '../providers/ProjectSyncContext'

export function useProjectSync() {
  const context = useContext(ProjectSyncContext)
  if (!context) {
    throw new Error('useProjectSync debe utilizarse dentro de ProjectSyncProvider.')
  }
  return context
}
