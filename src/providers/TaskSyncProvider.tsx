import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { format, subDays } from 'date-fns'
import { useAuth } from '../hooks/auth'
import {
  isSupabaseId,
  taskFromRow,
  taskRepository,
} from '../repositories/taskRepository'
import { supabase } from '../lib/supabase/client'
import type { Database } from '../types/database.types'
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
    let applyingRemote = false
    let realtimeChannel: ReturnType<typeof supabase.channel> | undefined
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
        const cleanupDate = new Date()
        const cleanupKeyForToday = format(cleanupDate, 'yyyy-MM-dd')
        const cleanupKey = `faro-backlog-cleanup:${user.id}`
        if (localStorage.getItem(cleanupKey) !== cleanupKeyForToday) {
          const removedIds = typeof taskRepository.removeCompletedBefore === 'function'
            ? await taskRepository.removeCompletedBefore(subDays(cleanupDate, 3).toISOString(), user.id)
            : []
          if (removedIds.length) {
            const removed = new Set(removedIds)
            useFaroStore.setState((current) => ({ tasks: current.tasks.filter((task) => !removed.has(task.id)) }))
          }
          localStorage.setItem(cleanupKey, cleanupKeyForToday)
        }
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
          if (applyingRemote || current.tasks === previous.tasks) return

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
            .then(async () => {
              const operations = [
                ...added.map((task) => ({ kind: 'create' as const, task, run: () => taskRepository.create(safeRemoteTask(task), user.id) })),
                ...updated.map((task) => ({ kind: 'update' as const, task, previous: previousById.get(task.id), run: () => taskRepository.update(safeRemoteTask(task), user.id) })),
                ...removed.map((task) => ({ kind: 'remove' as const, task, run: () => taskRepository.remove(task.id, user.id) })),
              ]
              const results = await Promise.allSettled(operations.map((operation) => operation.run()))
              const failed = operations.filter((_, index) => results[index].status === 'rejected')
              if (failed.length) {
                useFaroStore.setState((current) => {
                  const byId = new Map(current.tasks.map((task) => [task.id, task]))
                  for (const operation of failed) {
                    if (operation.kind === 'create') byId.delete(operation.task.id)
                    else if (operation.kind === 'update' && operation.previous) byId.set(operation.previous.id, operation.previous)
                    else if (operation.kind === 'remove') byId.set(operation.task.id, operation.task)
                  }
                  return { tasks: [...byId.values()] }
                })
                throw new Error('No se guardaron algunos cambios; FARO restauró el estado anterior.')
              }
            })
            .then(() => {
              if (active) {
                setState('ready')
                setError(null)
              }
            })
            .catch(reportError)
        })

        realtimeChannel = supabase.channel(`tasks:${user.id}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${user.id}` }, (payload) => {
            if (!active) return
            applyingRemote = true
            try {
              useFaroStore.setState((current) => {
                if (payload.eventType === 'DELETE') {
                  const deleted = payload.old as Pick<Database['public']['Tables']['tasks']['Row'], 'id'>
                  return { tasks: current.tasks.filter((task) => task.id !== deleted.id) }
                }
                const remote = taskFromRow(payload.new as Database['public']['Tables']['tasks']['Row'])
                const exists = current.tasks.some((task) => task.id === remote.id)
                return { tasks: exists ? current.tasks.map((task) => task.id === remote.id ? remote : task) : [...current.tasks, remote] }
              })
            } finally { applyingRemote = false }
          }).subscribe()

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
      if (realtimeChannel) void supabase.removeChannel(realtimeChannel)
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
