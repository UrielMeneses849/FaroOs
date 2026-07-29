import { useContext } from 'react'
import { GoalSyncContext } from '../providers/GoalSyncContext'

export function useGoalSync() {
  const context = useContext(GoalSyncContext)
  if (!context) {
    throw new Error('useGoalSync debe utilizarse dentro de GoalSyncProvider.')
  }
  return context
}
