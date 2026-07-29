import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../hooks/auth'
import {
  isSupabaseProjectId,
  projectRepository,
} from '../repositories/projectRepository'
import { useFaroStore } from '../store'
import type { Project } from '../types'
import { GoalSyncContext } from './GoalSyncContext'
import { ProjectSyncContext, type ProjectSyncState } from './ProjectSyncContext'

const projectChanged = (previous: Project, current: Project) =>
  previous.title !== current.title
  || previous.description !== current.description
  || previous.area !== current.area
  || previous.status !== current.status
  || previous.goalId !== current.goalId
  || previous.startDate !== current.startDate
  || previous.endDate !== current.endDate
  || previous.workspaceId !== current.workspaceId
  || previous.updatedAt !== current.updatedAt

export function ProjectSyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const goalSync = useContext(GoalSyncContext)
  const [state, setState] = useState<ProjectSyncState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    if (!user || goalSync?.state === 'idle' || goalSync?.state === 'syncing') return

    let active = true
    let unsubscribe: (() => void) | undefined
    const goalRelationsReady = !goalSync || goalSync.state === 'ready'
    const safeRemoteProject = (project: Project): Project =>
      goalRelationsReady ? project : { ...project, goalId: undefined }
    const reportError = (reason: unknown) => {
      if (!active) return
      setState('error')
      setError(reason instanceof Error ? reason.message : 'No fue posible sincronizar Projects.')
    }

    const start = async () => {
      setState('syncing')
      setError(null)

      try {
        const remoteProjects = await projectRepository.list(user.id)
        if (!active) return

        const localProjects = useFaroStore.getState().projects
        const localById = new Map(localProjects.map((project) => [project.id, project]))
        const normalizedRemote = remoteProjects.map((project) => ({
          ...project,
          priority: localById.get(project.id)?.priority ?? project.priority,
          goalId: project.goalId ?? localById.get(project.id)?.goalId,
        }))
        const remoteIds = new Set(normalizedRemote.map((project) => project.id))
        const pendingLocal = localProjects.filter(
          (project) => isSupabaseProjectId(project.id) && !remoteIds.has(project.id),
        )
        const pendingRelationships = normalizedRemote.filter((project) => {
          const original = remoteProjects.find((item) => item.id === project.id)
          return goalRelationsReady
            && project.goalId
            && original?.goalId !== project.goalId
        })
        const uploads = await Promise.allSettled([
          ...pendingLocal.map((project) =>
            projectRepository.create(safeRemoteProject(project), user.id)),
          ...pendingRelationships.map((project) =>
            projectRepository.update(safeRemoteProject(project), user.id)),
        ])
        const uploaded = uploads.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        )
        const remoteById = new Map(
          [...normalizedRemote, ...uploaded].map((project) => [
            project.id,
            {
              ...project,
              priority: localById.get(project.id)?.priority ?? project.priority,
            },
          ]),
        )

        useFaroStore.setState((current) => {
          const projects = [
            ...current.projects
              .filter((project) => !remoteById.has(project.id))
              .map((project) => ({ ...project })),
            ...remoteById.values(),
          ]
          return {
            projects,
            goals: current.goals.map((goal) => ({
              ...goal,
              projectIds: projects
                .filter((project) => project.goalId === goal.id)
                .map((project) => project.id),
            })),
          }
        })

        let queue: Promise<unknown> = Promise.resolve()
        unsubscribe = useFaroStore.subscribe((current, previous) => {
          if (current.projects === previous.projects) return

          const previousById = new Map(previous.projects.map((project) => [project.id, project]))
          const currentById = new Map(current.projects.map((project) => [project.id, project]))
          const added = current.projects.filter(
            (project) => isSupabaseProjectId(project.id) && !previousById.has(project.id),
          )
          const updated = current.projects.filter((project) => {
            const oldProject = previousById.get(project.id)
            return isSupabaseProjectId(project.id)
              && oldProject
              && projectChanged(oldProject, project)
          })
          const removed = previous.projects.filter(
            (project) => isSupabaseProjectId(project.id) && !currentById.has(project.id),
          )

          if (!added.length && !updated.length && !removed.length) return
          setState('syncing')
          queue = queue
            .then(() => Promise.all([
              ...added.map((project) =>
                projectRepository.create(safeRemoteProject(project), user.id)),
              ...updated.map((project) =>
                projectRepository.update(safeRemoteProject(project), user.id)),
              ...removed.map((project) => projectRepository.remove(project.id, user.id)),
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
          setError('Algunos proyectos locales siguen pendientes de sincronización.')
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
  }, [attempt, goalSync, user])

  const value = useMemo(
    () => ({
      state: user ? state : 'idle' as const,
      error: user ? error : null,
      retry,
    }),
    [error, retry, state, user],
  )

  return <ProjectSyncContext.Provider value={value}>{children}</ProjectSyncContext.Provider>
}
