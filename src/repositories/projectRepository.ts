import { supabase } from '../lib/supabase/client'
import type { Database } from '../types/database.types'
import type { Project } from '../types'
import { isSupabaseGoalId } from './goalRepository'
import { goalRepository } from './goalRepository'
import { taskFromRow } from './taskRepository'
import { workspaceRepository } from './workspaceRepository'

type ProjectRow = Database['public']['Tables']['projects']['Row']
type ProjectInsert = Database['public']['Tables']['projects']['Insert']
type ProjectUpdate = Database['public']['Tables']['projects']['Update']

export const isSupabaseProjectId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)

export function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    area: row.area as Project['area'],
    status: row.status,
    goalId: row.goal_id ?? undefined,
    priority: row.priority === 'critical' ? 'high' : row.priority,
    startDate: row.start_date?.slice(0, 10) ?? undefined,
    endDate: row.target_date?.slice(0, 10) ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    archivedAt: row.archived_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function projectToInsert(project: Project, userId: string): ProjectInsert {
  return {
    id: project.id,
    user_id: userId,
    title: project.title,
    description: project.description ?? null,
    area: project.area,
    status: project.status,
    priority: project.priority,
    goal_id: project.goalId && isSupabaseGoalId(project.goalId)
      ? project.goalId
      : null,
    start_date: project.startDate ?? null,
    target_date: project.endDate ?? null,
    completed_at: project.status === 'completed' ? project.updatedAt : null,
    archived_at: project.archivedAt ?? null,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
    workspace_id: project.workspaceId ?? null,
  }
}

export function projectToUpdate(project: Project): ProjectUpdate {
  return {
    title: project.title,
    description: project.description ?? null,
    area: project.area,
    status: project.status,
    priority: project.priority,
    goal_id: project.goalId && isSupabaseGoalId(project.goalId)
      ? project.goalId
      : null,
    start_date: project.startDate ?? null,
    target_date: project.endDate ?? null,
    completed_at: project.status === 'completed' ? project.updatedAt : null,
    archived_at: project.archivedAt ?? null,
    updated_at: project.updatedAt,
    workspace_id: project.workspaceId ?? null,
  }
}

export const projectRepository = {
  getAll(userId: string) { return this.list(userId) },
  async list(userId: string): Promise<Project[]> {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data.map(projectFromRow)
  },
  async getById(id: string, userId: string) {
    const { data, error } = await supabase.from('projects').select('*')
      .eq('id', id).eq('user_id', userId).maybeSingle()
    if (error) throw error
    return data ? projectFromRow(data) : null
  },
  async getByWorkspace(workspaceId: string, userId: string) {
    const { data, error } = await supabase.from('projects').select('*')
      .eq('user_id', userId).eq('workspace_id', workspaceId).is('archived_at', null)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data.map(projectFromRow)
  },
  async getByGoal(goalId: string, userId: string) {
    const { data, error } = await supabase.from('projects').select('*')
      .eq('user_id', userId).eq('goal_id', goalId).is('archived_at', null).order('created_at')
    if (error) throw error
    return data.map(projectFromRow)
  },

  async create(project: Project, userId: string): Promise<Project> {
    const safeProject = await validateProject(project, userId)
    const { data, error } = await supabase
      .from('projects')
      .upsert(projectToInsert(safeProject, userId), { onConflict: 'id' })
      .select()
      .single()

    if (error) throw error
    return projectFromRow(data)
  },

  async update(project: Project, userId: string): Promise<Project> {
    const safeProject = await validateProject(project, userId, true)
    const { data, error } = await supabase
      .from('projects')
      .update(projectToUpdate(safeProject))
      .eq('id', project.id)
      .eq('user_id', userId)
      .select()
      .single()

    if (error) throw error
    return projectFromRow(data)
  },

  async remove(id: string, userId: string): Promise<void> {
    const { count, error: relationError } = await supabase.from('tasks')
      .select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('project_id', id)
    if (relationError) throw relationError
    if (count) throw new Error('No puedes eliminar un proyecto que todavía tiene tareas.')
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)

    if (error) throw error
  },
  async pause(id: string, userId: string) { return this.changeStatus(id, 'paused', userId) },
  async resume(id: string, userId: string) { return this.changeStatus(id, 'active', userId) },
  async complete(id: string, userId: string) { return this.changeStatus(id, 'completed', userId) },
  async reopen(id: string, userId: string) { return this.changeStatus(id, 'active', userId) },
  async changeStatus(id: string, status: Project['status'], userId: string) {
    const project = await this.getById(id, userId)
    if (!project) throw new Error('El proyecto ya no existe.')
    return this.update({ ...project, status, updatedAt: new Date().toISOString() }, userId)
  },
  async getWithTasks(id: string, userId: string) {
    const project = await this.getById(id, userId)
    if (!project) return null
    const [tasksResult, goal, workspace] = await Promise.all([
      supabase.from('tasks').select('*').eq('user_id', userId).eq('project_id', id).order('created_at'),
      project.goalId ? goalRepository.getById(project.goalId, userId) : null,
      project.workspaceId ? workspaceRepository.getById(project.workspaceId, userId) : null,
    ])
    if (tasksResult.error) throw tasksResult.error
    return { project, tasks: tasksResult.data.map(taskFromRow), goal, workspace }
  },
}

async function validateProject(project: Project, userId: string, checkExistingTasks = false) {
  if (!project.workspaceId) throw new Error('Selecciona un workspace para el proyecto.')
  const workspace = await workspaceRepository.getById(project.workspaceId, userId)
  if (!workspace) throw new Error('El workspace seleccionado no pertenece a tu cuenta.')
  let workspaceId = project.workspaceId
  if (project.goalId) {
    const goal = await goalRepository.getById(project.goalId, userId)
    if (!goal) throw new Error('El objetivo seleccionado no pertenece a tu cuenta.')
    if (!goal.workspaceId) throw new Error('El objetivo no tiene un workspace válido.')
    if (workspaceId !== goal.workspaceId) throw new Error('El proyecto debe usar el mismo workspace que su objetivo.')
    workspaceId = goal.workspaceId
  }
  if (checkExistingTasks) {
    const current = await projectRepository.getById(project.id, userId)
    if (current?.workspaceId && current.workspaceId !== workspaceId) {
      const { count, error } = await supabase.from('tasks').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('project_id', project.id)
      if (error) throw error
      if (count) throw new Error('Mueve primero las tareas antes de cambiar el workspace del proyecto.')
    }
  }
  return { ...project, workspaceId }
}
