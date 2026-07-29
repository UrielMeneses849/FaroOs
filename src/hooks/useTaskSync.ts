import { useContext } from 'react'
import { TaskSyncContext } from '../providers/TaskSyncContext'

export function useTaskSync() {
  const context = useContext(TaskSyncContext)
  if (!context) {
    throw new Error('useTaskSync debe utilizarse dentro de TaskSyncProvider.')
  }
  return context
}
