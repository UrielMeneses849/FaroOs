import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../hooks/auth'
import {
  isSupabaseId,
  taskRepository,
} from '../repositories/taskRepository'
import { useFaroStore } from '../store'
import type { Task } from '../types'
import { GoalSyncContext } from './GoalSyncContext'
import { ProjectSyncContext } from './ProjectSyncContext'
import { TaskSyncContext, type TaskSyncState } from './TaskSyncContext'

const taskChanged = (previous: Task, current: Task) =>
  previous.title !== current.title
  || previous.description !== current.description
  || previous.notes !== current.notes
  || previous.area !== current.area
  || previous.status !== current.status
  || previous.priority !== current.priority
  || previous.projectId !== current.projectId
  || previous.goalId !== current.goalId
  || previous.dueDate !== current.dueDate
  || previous.dueAt !== current.dueAt
  || previous.estimatedMinutes !== current.estimatedMinutes
  || previous.sortOrder !== current.sortOrder
  || previous.workspaceId !== current.workspaceId
  || previous.stakeholder !== current.stakeholder
  || previous.waitingFor !== current.waitingFor
  || previous.blockerReason !== current.blockerReason
  || previous.pausedUntil !== current.pausedUntil
  || previous.updatedAt !== current.updatedAt

export function TaskSyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const goalSync = useContext(GoalSyncContext)
  const projectSync = useContext(ProjectSyncContext)
  const [state, setState] = useState<TaskSyncState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    if (
      !user
      || goalSync?.state === 'idle'
      || goalSync?.state === 'syncing'
      || projectSync?.state === 'idle'
      || projectSync?.state === 'syncing'
    ) return

    let active = true
    let unsubscribe: (() => void) | undefined
    const goalRelationsReady = !goalSync || goalSync.state === 'ready'
    const projectRelationsReady = !projectSync || projectSync.state === 'ready'
    const safeRemoteTask = (task: Task): Task =>
      ({
        ...task,
        goalId: goalRelationsReady ? task.goalId : undefined,
        projectId: projectRelationsReady ? task.projectId : undefined,
      })
    const reportError = (reason: unknown) => {
      if (!active) return
      setState('error')
      setError(reason instanceof Error ? reason.message : 'No fue posible sincronizar Tasks.')
    }

    const start = async () => {
      setState('syncing')
      setError(null)

      try {
        const remoteTasks = await taskRepository.list(user.id)
        if (!active) return

        const localTasks = useFaroStore.getState().tasks
        const localById = new Map(localTasks.map((task) => [task.id, task]))
        const normalizedRemoteTasks = remoteTasks.map((task) => {
          const localTask = localById.get(task.id)
          return {
            ...task,
            projectId: task.projectId ?? localTask?.projectId,
            goalId: task.goalId ?? localTask?.goalId,
          }
        })
        const remoteIds = new Set(normalizedRemoteTasks.map((task) => task.id))
        const pendingLocalTasks = localTasks.filter(
          (task) => isSupabaseId(task.id) && !remoteIds.has(task.id),
        )
        const pendingRelationshipUpdates = normalizedRemoteTasks.filter((task) => {
          const original = remoteTasks.find((item) => item.id === task.id)
          return (
              (goalRelationsReady
                && task.goalId
                && isSupabaseId(task.goalId)
                && original?.goalId !== task.goalId)
              || (projectRelationsReady
                && task.projectId
                && original?.projectId !== task.projectId)
            )
        })

        const uploads = await Promise.allSettled(
          [
            ...pendingLocalTasks.map((task) => taskRepository.create(safeRemoteTask(task), user.id)),
            ...pendingRelationshipUpdates.map((task) => taskRepository.update(safeRemoteTask(task), user.id)),
          ],
        )
        const uploadedTasks = uploads.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        )
        const remoteById = new Map(
          [...normalizedRemoteTasks, ...uploadedTasks].map((task) => [task.id, task]),
        )

        useFaroStore.setState((current) => ({
          tasks: [
            ...current.tasks
              .filter((task) => !remoteById.has(task.id))
              .map((task) => ({ ...task })),
            ...remoteById.values(),
          ],
        }))

        let queue: Promise<unknown> = Promise.resolve()
        unsubscribe = useFaroStore.subscribe((current, previous) => {
          if (current.tasks === previous.tasks) return

          const previousById = new Map(previous.tasks.map((task) => [task.id, task]))
          const currentById = new Map(current.tasks.map((task) => [task.id, task]))
          const added = current.tasks.filter(
            (task) => isSupabaseId(task.id) && !previousById.has(task.id),
          )
          const updated = current.tasks.filter((task) => {
            const oldTask = previousById.get(task.id)
            return isSupabaseId(task.id) && oldTask && taskChanged(oldTask, task)
          })
          const removed = previous.tasks.filter(
            (task) => isSupabaseId(task.id) && !currentById.has(task.id),
          )

          if (!added.length && !updated.length && !removed.length) return
          setState('syncing')
          queue = queue
            .then(() => Promise.all([
              ...added.map((task) => taskRepository.create(safeRemoteTask(task), user.id)),
              ...updated.map((task) => taskRepository.update(safeRemoteTask(task), user.id)),
              ...removed.map((task) => taskRepository.remove(task.id, user.id)),
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
          setError('Algunas tareas locales siguen pendientes de sincronización.')
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
  }, [attempt, goalSync, projectSync, user])

  const value = useMemo(
    () => ({
      state: user ? state : 'idle' as const,
      error: user ? error : null,
      retry,
    }),
    [error, retry, state, user],
  )

  return (
    <TaskSyncContext.Provider value={value}>
      {children}
    </TaskSyncContext.Provider>
  )
}
