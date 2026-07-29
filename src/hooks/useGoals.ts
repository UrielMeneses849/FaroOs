import { useMemo } from 'react'
import { useFaroStore } from '../store'
import type { Goal } from '../types'
import { useGoalSync } from './useGoalSync'

export function useGoals() {
  const goals = useFaroStore((state) => state.goals)
  const data = useMemo(() => goals.filter((goal) => !goal.archivedAt), [goals])
  const createGoal = useFaroStore((state) => state.createGoal)
  const updateGoal = useFaroStore((state) => state.updateGoal)
  const deleteGoal = useFaroStore((state) => state.deleteGoal)
  const projects = useFaroStore((state) => state.projects)
  const sync = useGoalSync()
  return {
    data, loading: sync.state === 'idle' || sync.state === 'syncing',
    error: sync.error, refresh: sync.retry, createGoal, updateGoal,
    deleteGoal: (id: string) => {
      if (projects.some((project) => project.goalId === id && !project.archivedAt)) return false
      deleteGoal(id)
      return true
    },
    pauseGoal: (id: string) => updateGoal(id, { status: 'paused' }),
    completeGoal: (id: string) => updateGoal(id, { status: 'completed' }),
    reopenGoal: (id: string) => updateGoal(id, { status: 'active' }),
  }
}

export function useGoal(id?: string) {
  const goals = useGoals()
  return { ...goals, data: goals.data.find((goal) => goal.id === id) ?? null }
}

export function useWorkspaceGoals(workspaceId?: string) {
  const goals = useGoals()
  const data = useMemo(
    () => goals.data.filter((goal) => !workspaceId || goal.workspaceId === workspaceId),
    [goals.data, workspaceId],
  )
  return { ...goals, data }
}

export const createGoalDraft = (
  input: Omit<Goal, 'id' | 'projectIds' | 'createdAt' | 'updatedAt'>,
): Goal => {
  const timestamp = new Date().toISOString()
  return { ...input, id: crypto.randomUUID(), projectIds: [], createdAt: timestamp, updatedAt: timestamp }
}
