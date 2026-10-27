import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { format } from 'date-fns'
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
import { shouldUploadMissingLocalTask } from './taskSyncPolicy'
import { TaskNotFoundError } from '../repositories/taskErrors'

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
  || previous.completedAt !== current.completedAt
  || previous.sortOrder !== current.sortOrder
  || previous.workspaceId !== current.workspaceId
  || previous.stakeholder !== current.stakeholder
  || previous.waitingFor !== current.waitingFor
  || previous.blockerReason !== current.blockerReason
  || previous.pausedUntil !== current.pausedUntil
  || previous.sectionId !== current.sectionId
  || previous.taskType !== current.taskType
  || previous.updatedAt !== current.updatedAt

const taskNeedsFullUpdate = (previous: Task, current: Task) =>
  previous.title !== current.title
  || previous.description !== current.description
  || previous.notes !== current.notes
  || previous.area !== current.area
  || previous.priority !== current.priority
  || previous.projectId !== current.projectId
  || previous.goalId !== current.goalId
  || previous.dueDate !== current.dueDate
  || previous.dueAt !== current.dueAt
  || previous.estimatedMinutes !== current.estimatedMinutes
  || previous.archivedAt !== current.archivedAt
  || previous.workspaceId !== current.workspaceId
  || previous.stakeholder !== current.stakeholder
  || previous.waitingFor !== current.waitingFor
  || previous.blockerReason !== current.blockerReason
  || previous.pausedUntil !== current.pausedUntil
  || previous.sectionId !== current.sectionId
  || previous.taskType !== current.taskType

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
    let removeVoiceRefresh: (() => void) | undefined
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
          // Housekeeping must never prevent the canonical remote Backlog read.
          // A fresh Desktop has no local marker yet, so it may be the first
          // surface to reach an older deployment where this optional RPC is
          // not available. In that case the task list is still fully usable.
          try {
            const cleanup = await taskRepository.runSmartCleaner(user.id)
            const removedIds = cleanup.cleanedIds
            if (removedIds.length) {
              const removed = new Set(removedIds)
              useFaroStore.setState((current) => ({ tasks: current.tasks.filter((task) => !removed.has(task.id)) }))
            }
            if (import.meta.env.DEV) console.info('[FARO Smart Cleaner]', {
              scanned: cleanup.scanned,
              eligible: cleanup.eligible,
              cleaned: cleanup.cleaned,
              skipped_missing_completed_at: cleanup.skippedMissingCompletedAt,
              errors: cleanup.errors,
            })
            localStorage.setItem(cleanupKey, cleanupKeyForToday)
          } catch (cleanupError) {
            if (import.meta.env.DEV) console.debug('[FARO Smart Cleaner] skipped', cleanupError)
          }
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
          (task) => isSupabaseId(task.id)
            && !remoteIds.has(task.id)
            && shouldUploadMissingLocalTask(task),
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
        const pendingWrites = new Map<string, number>()
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
          const changedTasks = [...added, ...updated, ...removed]
          for (const task of changedTasks) pendingWrites.set(task.id, (pendingWrites.get(task.id) ?? 0) + 1)
          setState('syncing')
          queue = queue
            .then(async () => {
              const operations = [
                ...added.map((task) => ({ kind: 'create' as const, task, run: () => taskRepository.create(safeRemoteTask(task), user.id) })),
                ...updated.map((task) => {
                  const previousTask = previousById.get(task.id)
                  return {
                    kind: 'update' as const,
                    task,
                    previous: previousTask,
                    run: async () => {
                      try {
                        return previousTask && !taskNeedsFullUpdate(previousTask, task)
                          ? await taskRepository.updateStatus(task.id, task.status, user.id, task.sortOrder)
                          : await taskRepository.update(safeRemoteTask(task), user.id)
                      } catch (reason) {
                        if (!(reason instanceof TaskNotFoundError) || previousTask?.status !== 'done' || task.status === 'done') throw reason
                        return taskRepository.restore(safeRemoteTask(task), user.id)
                      }
                    },
                  }
                }),
                ...removed.map((task) => ({ kind: 'remove' as const, task, run: () => taskRepository.remove(task.id, user.id) })),
              ]
              const results = await Promise.allSettled(operations.map((operation) => operation.run()))
              const failed = operations.filter((_, index) => results[index].status === 'rejected')
              if (!active) return
              // Server responses and rollbacks are remote applications, never
              // new user edits. Only replace the exact snapshot we submitted:
              // a later edit (or deletion) must survive an older request.
              applyingRemote = true
              try {
                useFaroStore.setState((current) => {
                  const byId = new Map(current.tasks.map((task) => [task.id, task]))
                  operations.forEach((operation, index) => {
                    const currentTask = byId.get(operation.task.id)
                    if (operation.kind === 'remove' ? currentTask !== undefined : currentTask !== operation.task) return
                    const result = results[index]
                    if (result.status === 'fulfilled') {
                      if (result.value) byId.set(operation.task.id, result.value)
                    } else if (operation.kind === 'create') byId.delete(operation.task.id)
                    else if (operation.kind === 'update' && operation.previous) byId.set(operation.previous.id, operation.previous)
                    else if (operation.kind === 'remove') byId.set(operation.task.id, operation.task)
                  })
                  return { tasks: [...byId.values()] }
                })
              } finally { applyingRemote = false }
              if (failed.length) {
                const failure = results.find((result) => result.status === 'rejected')
                const reason = failure?.status === 'rejected' ? failure.reason : undefined
                const detail = reason && typeof reason === 'object' && 'message' in reason ? String(reason.message) : ''
                throw new Error(`No se guardaron algunos cambios; FARO restauró el estado anterior.${detail ? ` ${detail}` : ''}`)
              }
            })
            .then(() => {
              if (active) {
                setState('ready')
                setError(null)
              }
            })
            .catch(reportError)
            .finally(() => {
              for (const task of changedTasks) {
                const remaining = (pendingWrites.get(task.id) ?? 1) - 1
                if (remaining) pendingWrites.set(task.id, remaining)
                else pendingWrites.delete(task.id)
              }
            })
        })

        realtimeChannel = supabase.channel(`tasks:${user.id}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${user.id}` }, (payload) => {
            if (!active) return
            applyingRemote = true
            try {
              useFaroStore.setState((current) => {
                if (payload.eventType === 'DELETE') {
                  const deleted = payload.old as Pick<Database['public']['Tables']['tasks']['Row'], 'id'>
                  if (pendingWrites.has(deleted.id)) return current
                  return { tasks: current.tasks.filter((task) => task.id !== deleted.id) }
                }
                const remote = taskFromRow(payload.new as Database['public']['Tables']['tasks']['Row'])
                if (pendingWrites.has(remote.id)) return current
                const local = current.tasks.find((task) => task.id === remote.id)
                if (local && Date.parse(remote.updatedAt) < Date.parse(local.updatedAt)) return current
                const exists = Boolean(local)
                return { tasks: exists ? current.tasks.map((task) => task.id === remote.id ? remote : task) : [...current.tasks, remote] }
              })
            } finally { applyingRemote = false }
          }).subscribe()

        // Voice mutations happen in the Edge Function. Realtime remains the
        // canonical sync path, while this refresh makes the Backlog projection
        // deterministic even if the websocket delivery arrives a moment later.
        const refreshFromVoice = async () => {
          try {
            const latest = await taskRepository.list(user.id)
            if (!active) return
            applyingRemote = true
            useFaroStore.setState((current) => ({
              tasks: [
                ...latest.filter((task) => !pendingWrites.has(task.id)),
                ...current.tasks.filter((task) => pendingWrites.has(task.id)),
              ],
            }))
          } catch (reason) {
            if (import.meta.env.DEV) console.debug('[FARO Backlog] voice refresh failed', reason)
          } finally { applyingRemote = false }
        }
        window.addEventListener('faro:backlog-updated', refreshFromVoice)
        removeVoiceRefresh = () => window.removeEventListener('faro:backlog-updated', refreshFromVoice)

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
      removeVoiceRefresh?.()
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
