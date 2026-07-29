import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../hooks/auth'
import {
  goalRepository,
  isSupabaseGoalId,
} from '../repositories/goalRepository'
import { useFaroStore } from '../store'
import type { Goal } from '../types'
import { GoalSyncContext, type GoalSyncState } from './GoalSyncContext'

const goalChanged = (previous: Goal, current: Goal) =>
  previous.title !== current.title
  || previous.description !== current.description
  || previous.area !== current.area
  || previous.status !== current.status
  || previous.targetDate !== current.targetDate
  || previous.workspaceId !== current.workspaceId
  || previous.updatedAt !== current.updatedAt

export function GoalSyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [state, setState] = useState<GoalSyncState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    if (!user) return

    let active = true
    let unsubscribe: (() => void) | undefined
    const reportError = (reason: unknown) => {
      if (!active) return
      setState('error')
      setError(reason instanceof Error ? reason.message : 'No fue posible sincronizar Goals.')
    }

    const start = async () => {
      setState('syncing')
      setError(null)

      try {
        const remoteGoals = await goalRepository.list(user.id)
        if (!active) return

        const remoteIds = new Set(remoteGoals.map((goal) => goal.id))
        const localGoals = useFaroStore.getState().goals
        const pendingLocalGoals = localGoals.filter(
          (goal) => isSupabaseGoalId(goal.id) && !remoteIds.has(goal.id),
        )
        const uploads = await Promise.allSettled(
          pendingLocalGoals.map((goal) => goalRepository.create(goal, user.id)),
        )
        const uploadedGoals = uploads.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        )
        const localById = new Map(localGoals.map((goal) => [goal.id, goal]))
        const remoteById = new Map(
          [...remoteGoals, ...uploadedGoals].map((goal) => [
            goal.id,
            {
              ...goal,
              projectIds: localById.get(goal.id)?.projectIds ?? goal.projectIds,
            },
          ]),
        )

        useFaroStore.setState((current) => ({
          goals: [
            ...current.goals
              .filter((goal) => !remoteById.has(goal.id))
              .map((goal) => ({ ...goal })),
            ...remoteById.values(),
          ],
        }))

        let queue: Promise<unknown> = Promise.resolve()
        unsubscribe = useFaroStore.subscribe((current, previous) => {
          if (current.goals === previous.goals) return

          const previousById = new Map(previous.goals.map((goal) => [goal.id, goal]))
          const currentById = new Map(current.goals.map((goal) => [goal.id, goal]))
          const added = current.goals.filter(
            (goal) => isSupabaseGoalId(goal.id) && !previousById.has(goal.id),
          )
          const updated = current.goals.filter((goal) => {
            const oldGoal = previousById.get(goal.id)
            return isSupabaseGoalId(goal.id) && oldGoal && goalChanged(oldGoal, goal)
          })
          const removed = previous.goals.filter(
            (goal) => isSupabaseGoalId(goal.id) && !currentById.has(goal.id),
          )

          if (!added.length && !updated.length && !removed.length) return
          setState('syncing')
          queue = queue
            .then(() => Promise.all([
              ...added.map((goal) => goalRepository.create(goal, user.id)),
              ...updated.map((goal) => goalRepository.update(goal, user.id)),
              ...removed.map((goal) => goalRepository.remove(goal.id, user.id)),
            ]))
            .then(() => {
              if (active) {
                setState('ready')
                setError(null)
              }
            })
            .catch(reportError)
        })

        setState(uploads.some((result) => result.status === 'rejected') ? 'error' : 'ready')
        if (uploads.some((result) => result.status === 'rejected')) {
          setError('Algunos objetivos locales siguen pendientes de sincronización.')
        }
      } catch (reason) {
        reportError(reason)
      }
    }

    void start()

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [attempt, user])

  const value = useMemo(
    () => ({
      state: user ? state : 'idle' as const,
      error: user ? error : null,
      retry,
    }),
    [error, retry, state, user],
  )

  return <GoalSyncContext.Provider value={value}>{children}</GoalSyncContext.Provider>
}
