import { supabase } from '../lib/supabase/client'
import type { Database } from '../types/database.types'
import type { Goal } from '../types'
import { workspaceRepository } from './workspaceRepository'

type GoalRow = Database['public']['Tables']['goals']['Row']
type GoalInsert = Database['public']['Tables']['goals']['Insert']
type GoalUpdate = Database['public']['Tables']['goals']['Update']

export const isSupabaseGoalId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)

export function goalFromRow(row: GoalRow): Goal {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    area: row.area as Goal['area'],
    status: row.status,
    targetDate: row.target_date?.slice(0, 10) ?? undefined,
    projectIds: [],
    workspaceId: row.workspace_id ?? undefined,
    archivedAt: row.archived_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function goalToInsert(goal: Goal, userId: string): GoalInsert {
  return {
    id: goal.id,
    user_id: userId,
    title: goal.title,
    description: goal.description ?? null,
    area: goal.area,
    status: goal.status,
    target_date: goal.targetDate ?? null,
    completed_at: goal.status === 'completed' ? goal.updatedAt : null,
    archived_at: goal.archivedAt ?? null,
    created_at: goal.createdAt,
    updated_at: goal.updatedAt,
    workspace_id: goal.workspaceId ?? null,
  }
}

export function goalToUpdate(goal: Goal): GoalUpdate {
  return {
    title: goal.title,
    description: goal.description ?? null,
    area: goal.area,
    status: goal.status,
    target_date: goal.targetDate ?? null,
    completed_at: goal.status === 'completed' ? goal.updatedAt : null,
    archived_at: goal.archivedAt ?? null,
    updated_at: goal.updatedAt,
    workspace_id: goal.workspaceId ?? null,
  }
}

export const goalRepository = {
  getAll(userId: string) { return this.list(userId) },
  async list(userId: string): Promise<Goal[]> {
    const { data, error } = await supabase
      .from('goals')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data.map(goalFromRow)
  },
  async getById(id: string, userId: string) {
    const { data, error } = await supabase.from('goals').select('*')
      .eq('id', id).eq('user_id', userId).maybeSingle()
    if (error) throw error
    return data ? goalFromRow(data) : null
  },
  async getByWorkspace(workspaceId: string, userId: string) {
    const { data, error } = await supabase.from('goals').select('*')
      .eq('user_id', userId).eq('workspace_id', workspaceId)
      .is('archived_at', null).order('created_at', { ascending: false })
    if (error) throw error
    return data.map(goalFromRow)
  },

  async create(goal: Goal, userId: string): Promise<Goal> {
    await assertGoalWorkspace(goal, userId)
    const { data, error } = await supabase
      .from('goals')
      .upsert(goalToInsert(goal, userId), { onConflict: 'id' })
      .select()
      .single()

    if (error) throw error
    return goalFromRow(data)
  },

  async update(goal: Goal, userId: string): Promise<Goal> {
    await assertGoalWorkspace(goal, userId)
    const { data, error } = await supabase
      .from('goals')
      .update(goalToUpdate(goal))
      .eq('id', goal.id)
      .eq('user_id', userId)
      .select()
      .single()

    if (error) throw error
    return goalFromRow(data)
  },

  async remove(id: string, userId: string): Promise<void> {
    const { count, error: relationError } = await supabase.from('projects')
      .select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('goal_id', id)
    if (relationError) throw relationError
    if (count) throw new Error('No puedes eliminar un objetivo que todavía tiene proyectos.')
    const { error } = await supabase
      .from('goals')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)

    if (error) throw error
  },
  async pause(id: string, userId: string) { return this.changeStatus(id, 'paused', userId) },
  async resume(id: string, userId: string) { return this.changeStatus(id, 'active', userId) },
  async complete(id: string, userId: string) { return this.changeStatus(id, 'completed', userId) },
  async reopen(id: string, userId: string) { return this.changeStatus(id, 'active', userId) },
  async changeStatus(id: string, status: Goal['status'], userId: string) {
    const goal = await this.getById(id, userId)
    if (!goal) throw new Error('El objetivo ya no existe.')
    return this.update({ ...goal, status, updatedAt: new Date().toISOString() }, userId)
  },
  async getWithProjects(id: string, userId: string) {
    const goal = await this.getById(id, userId)
    if (!goal) return null
    const { data, error } = await supabase.from('projects').select('*')
      .eq('user_id', userId).eq('goal_id', id).order('created_at')
    if (error) throw error
    const projects = data.map((row) => ({
      id: row.id, title: row.title, description: row.description ?? undefined,
      area: row.area as Goal['area'], status: row.status, priority: row.priority,
      goalId: row.goal_id ?? undefined, workspaceId: row.workspace_id ?? undefined,
      startDate: row.start_date?.slice(0, 10) ?? undefined,
      endDate: row.target_date?.slice(0, 10) ?? undefined,
      archivedAt: row.archived_at ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at,
    }))
    return { goal: { ...goal, projectIds: projects.map((project) => project.id) }, projects }
  },
}

async function assertGoalWorkspace(goal: Goal, userId: string) {
  if (!goal.workspaceId) throw new Error('Selecciona un workspace para el objetivo.')
  const workspace = await workspaceRepository.getById(goal.workspaceId, userId)
  if (!workspace) throw new Error('El workspace seleccionado no pertenece a tu cuenta.')
}
