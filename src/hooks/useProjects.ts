import { useMemo } from 'react'
import { useFaroStore } from '../store'
import type { Project } from '../types'
import { useProjectSync } from './useProjectSync'

export function useProjects() {
  const projects = useFaroStore((state) => state.projects)
  const data = useMemo(
    () => projects.filter((project) => !project.archivedAt),
    [projects],
  )
  const createProject = useFaroStore((state) => state.createProject)
  const updateProject = useFaroStore((state) => state.updateProject)
  const deleteProject = useFaroStore((state) => state.deleteProject)
  const tasks = useFaroStore((state) => state.tasks)
  const sync = useProjectSync()
  return {
    data, loading: sync.state === 'idle' || sync.state === 'syncing',
    error: sync.error, refresh: sync.retry, createProject, updateProject,
    deleteProject: (id: string) => {
      if (tasks.some((task) => task.projectId === id && !task.archivedAt)) return false
      deleteProject(id)
      return true
    },
    pauseProject: (id: string) => updateProject(id, { status: 'paused' }),
    completeProject: (id: string) => updateProject(id, { status: 'completed' }),
    reopenProject: (id: string) => updateProject(id, { status: 'active' }),
  }
}

export function useProject(id?: string) {
  const projects = useProjects()
  return { ...projects, data: projects.data.find((project) => project.id === id) ?? null }
}

export function useWorkspaceProjects(workspaceId?: string) {
  const projects = useProjects()
  const data = useMemo(
    () => projects.data.filter((project) => !workspaceId || project.workspaceId === workspaceId),
    [projects.data, workspaceId],
  )
  return { ...projects, data }
}

export const createProjectDraft = (
  input: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>,
): Project => {
  const timestamp = new Date().toISOString()
  return { ...input, id: crypto.randomUUID(), createdAt: timestamp, updatedAt: timestamp }
}
