import { supabase } from '../lib/supabase/client'
import { formatLocalDateOnly, normalizeDateOnly, normalizeTimestamp } from '../lib/calendarDates'
import type { Database } from '../types/database.types'
import type { Task } from '../types'
import { isSupabaseProjectId } from './projectRepository'

type TaskRow = Database['public']['Tables']['tasks']['Row']
type TaskInsert = Database['public']['Tables']['tasks']['Insert']
type TaskUpdate = Database['public']['Tables']['tasks']['Update']

export const isSupabaseId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)

export function taskFromRow(row: TaskRow): Task {
  const dueAt = normalizeTimestamp(row.due_at)
  const dueDate = dueAt ? formatLocalDateOnly(dueAt) : normalizeDateOnly(row.due_at)
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    notes: row.notes ?? row.description ?? undefined,
    area: row.area as Task['area'],
    status: row.status,
    priority: row.priority,
    projectId: row.project_id ?? undefined,
    goalId: row.goal_id ?? undefined,
    dueDate: dueDate ?? undefined,
    dueAt: dueAt ?? undefined,
    estimatedMinutes: row.estimated_minutes ?? undefined,
    sortOrder: row.sort_order,
    archivedAt: row.archived_at ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    stakeholder: row.stakeholder ?? undefined,
    waitingFor: row.waiting_for ?? undefined,
    blockerReason: row.blocker_reason ?? undefined,
    pausedUntil: row.paused_until ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function taskToInsert(task: Task, userId: string): TaskInsert {
  return {
    id: task.id,
    user_id: userId,
    title: task.title,
    notes: task.notes ?? null,
    description: task.description ?? null,
    area: task.area,
    status: task.status,
    priority: task.priority,
    due_at: task.dueAt ?? task.dueDate ?? null,
    estimated_minutes: task.estimatedMinutes ?? null,
    sort_order: task.sortOrder ?? 0,
    completed_at: task.status === 'done' ? task.updatedAt : null,
    archived_at: task.archivedAt ?? null,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    project_id: task.projectId && isSupabaseProjectId(task.projectId)
      ? task.projectId
      : null,
    goal_id: task.goalId && isSupabaseId(task.goalId) ? task.goalId : null,
    workspace_id: task.workspaceId ?? null,
    stakeholder: task.stakeholder ?? null,
    waiting_for: task.waitingFor ?? null,
    blocker_reason: task.blockerReason ?? null,
    paused_until: task.pausedUntil ?? null,
  }
}

export function taskToUpdate(task: Task): TaskUpdate {
  return {
    title: task.title,
    notes: task.notes ?? null,
    description: task.description ?? null,
    area: task.area,
    status: task.status,
    priority: task.priority,
    due_at: task.dueAt ?? task.dueDate ?? null,
    estimated_minutes: task.estimatedMinutes ?? null,
    sort_order: task.sortOrder ?? 0,
    completed_at: task.status === 'done' ? task.updatedAt : null,
    archived_at: task.archivedAt ?? null,
    goal_id: task.goalId && isSupabaseId(task.goalId) ? task.goalId : null,
    project_id: task.projectId && isSupabaseProjectId(task.projectId)
      ? task.projectId
      : null,
    updated_at: task.updatedAt,
    workspace_id: task.workspaceId ?? null,
    stakeholder: task.stakeholder ?? null,
    waiting_for: task.waitingFor ?? null,
    blocker_reason: task.blockerReason ?? null,
    paused_until: task.pausedUntil ?? null,
  }
}

export const taskRepository = {
  getAll(userId: string) { return this.list(userId) },
  async list(userId: string): Promise<Task[]> {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data.map(taskFromRow)
  },

  async create(task: Task, userId: string): Promise<Task> {
    const safeTask = await validateTaskRelations(task, userId)
    const { data, error } = await supabase
      .from('tasks')
      .upsert(taskToInsert(safeTask, userId), { onConflict: 'id' })
      .select()
      .single()

    if (error) throw error
    return taskFromRow(data)
  },
  async getById(id: string, userId: string) {
    const { data, error } = await supabase.from('tasks').select('*')
      .eq('id', id).eq('user_id', userId).maybeSingle()
    if (error) throw error
    return data ? taskFromRow(data) : null
  },
  async getToday(userId: string, localDate: string, includeCompleted = false) {
    let query = supabase.from('tasks').select('*').eq('user_id', userId)
      .lte('due_at', `${localDate}T23:59:59.999`)
      .is('archived_at', null)
    if (!includeCompleted) query = query.neq('status', 'done')
    const { data, error } = await query.order('due_at')
    if (error) throw error
    return data.map(taskFromRow)
  },
  async getByWorkspace(workspaceId: string, userId: string) {
    const { data, error } = await supabase.from('tasks').select('*')
      .eq('user_id', userId).eq('workspace_id', workspaceId)
      .is('archived_at', null).order('due_at')
    if (error) throw error
    return data.map(taskFromRow)
  },

  async update(task: Task, userId: string): Promise<Task> {
    const safeTask = await validateTaskRelations(task, userId)
    const { data, error } = await supabase
      .from('tasks')
      .update(taskToUpdate(safeTask))
      .eq('id', task.id)
      .eq('user_id', userId)
      .select()
      .single()

    if (error) throw error
    return taskFromRow(data)
  },

  async remove(id: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)

    if (error) throw error
  },
  async removeCompletedBefore(cutoff: string, userId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('tasks')
      .delete()
      .eq('user_id', userId)
      .eq('status', 'done')
      .lt('completed_at', cutoff)
      .select('id')
    if (error) throw error
    return (data ?? []).map((item) => item.id)
  },
  async toggleComplete(id: string, userId: string) {
    const task = await this.getById(id, userId)
    if (!task) throw new Error('La tarea ya no existe.')
    return this.update({ ...task, status: task.status === 'done' ? 'todo' : 'done',
      updatedAt: new Date().toISOString() }, userId)
  },
  async moveToWorkspace(taskId: string, workspaceId: string, userId: string) {
    const task = await this.getById(taskId, userId)
    if (!task) throw new Error('La tarea ya no existe.')
    return this.update({ ...task, workspaceId, updatedAt: new Date().toISOString() }, userId)
  },
  async updateSchedule(id: string, dueAt: string, estimatedMinutes: number | undefined, userId: string) {
    const task = await this.getById(id, userId)
    if (!task) throw new Error('La tarea ya no existe.')
    return this.update({
      ...task,
      dueAt: dueAt.includes('T') ? dueAt : undefined,
      dueDate: dueAt.slice(0, 10),
      estimatedMinutes,
      updatedAt: new Date().toISOString(),
    }, userId)
  },
}

async function validateTaskRelations(task: Task, userId: string): Promise<Task> {
  if (!task.workspaceId) throw new Error('Selecciona un workspace para la tarea.')
  const { data: workspace, error: workspaceError } = await supabase.from('workspaces')
    .select('id').eq('id', task.workspaceId).eq('user_id', userId).maybeSingle()
  if (workspaceError) throw workspaceError
  if (!workspace) throw new Error('El workspace seleccionado no pertenece a tu cuenta.')
  if (!task.projectId) return task
  const { data: project, error } = await supabase.from('projects')
    .select('id, goal_id, workspace_id').eq('id', task.projectId).eq('user_id', userId).maybeSingle()
  if (error) throw error
  if (!project) throw new Error('El proyecto seleccionado no pertenece a tu cuenta.')
  if (!project.workspace_id || project.workspace_id !== task.workspaceId) {
    throw new Error('La tarea debe usar el mismo workspace que su proyecto.')
  }
  return { ...task, goalId: project.goal_id ?? task.goalId, workspaceId: project.workspace_id }
}
