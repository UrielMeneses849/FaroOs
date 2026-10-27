import { describe, expect, it } from 'vitest'
import type { Database } from '../types/database.types'
import type { Task } from '../types'
import {
  isSupabaseId,
  taskFromRow,
  taskStatusToUpdate,
  taskToInsert,
  taskToUpdate,
} from './taskRepository'

const task: Task = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  title: 'Conectar Tasks',
  notes: 'Sin conectar Goals todavía',
  area: 'personal',
  status: 'done',
  priority: 'high',
  projectId: 'project-local',
  goalId: 'goal-local',
  dueDate: '2026-07-25',
  estimatedMinutes: 45,
  createdAt: '2026-07-24T10:00:00.000Z',
  updatedAt: '2026-07-24T11:00:00.000Z',
  sectionId: '550e8400-e29b-41d4-a716-446655440003',
  taskType: 'ui',
}

describe('taskRepository mappers', () => {
  it('convierte una tarea local al esquema Supabase sin relaciones aún locales', () => {
    expect(taskToInsert(task, 'user-1')).toMatchObject({
      id: task.id,
      user_id: 'user-1',
      title: task.title,
      status: 'done',
      due_at: task.dueDate,
      completed_at: task.updatedAt,
      project_id: null,
      goal_id: null,
      section_id: task.sectionId,
      task_type: 'ui',
    })
  })

  it('genera actualizaciones completas y limpia completed_at al reabrir', () => {
    expect(taskToUpdate({ ...task, status: 'todo' })).toMatchObject({
      status: 'todo',
      completed_at: null,
      archived_at: null,
    })
  })

  it('preserva due_at con hora además de la fecha local derivada', () => {
    const timed = { ...task, dueAt: '2026-07-25T16:30:00.000Z' }
    expect(taskToInsert(timed, 'user-1')).toMatchObject({ due_at: timed.dueAt })
  })

  it('persiste el estado de espera y su dependencia sin marcar la tarea completada', () => {
    const waiting = { ...task, status: 'waiting' as const, waitingFor: 'Entrega de Ana' }
    expect(taskToInsert(waiting, 'user-1')).toMatchObject({ status: 'waiting', waiting_for: 'Entrega de Ana', completed_at: null })
    expect(taskToUpdate(waiting)).toMatchObject({ status: 'waiting', waiting_for: 'Entrega de Ana', completed_at: null })
  })

  it('genera un cambio de columna sin reescribir relaciones ajenas', () => {
    expect(taskStatusToUpdate('blocked', task.updatedAt, 4200)).toEqual({
      status: 'blocked',
      sort_order: 4200,
      completed_at: null,
      updated_at: task.updatedAt,
    })
  })

  it('sincroniza goal_id únicamente cuando la relación ya usa UUID', () => {
    const goalId = '550e8400-e29b-41d4-a716-446655440001'
    expect(taskToUpdate({ ...task, goalId })).toMatchObject({ goal_id: goalId })
    expect(taskToUpdate({ ...task, goalId: 'goal-local' })).toMatchObject({
      goal_id: null,
    })
  })

  it('sincroniza project_id únicamente para Projects con UUID', () => {
    const projectId = '550e8400-e29b-41d4-a716-446655440002'
    expect(taskToUpdate({ ...task, projectId })).toMatchObject({
      project_id: projectId,
    })
    expect(taskToUpdate({ ...task, projectId: 'project-local' })).toMatchObject({
      project_id: null,
    })
  })

  it('convierte estados y prioridad extendidos del backend al dominio actual', () => {
    const row: Database['public']['Tables']['tasks']['Row'] = {
      id: task.id,
      user_id: 'user-1',
      title: task.title,
      notes: task.notes ?? null,
      description: null,
      area: task.area,
      status: 'blocked',
      priority: 'critical',
      due_at: task.dueDate ?? null,
      estimated_minutes: task.estimatedMinutes ?? null,
      sort_order: 1000,
      project_id: null,
      goal_id: null,
      workspace_id: null,
      blocker_reason: 'Dependencia',
      completed_at: null,
      archived_at: null,
      paused_until: null,
      stakeholder: null,
      waiting_for: null,
      section_id: task.sectionId ?? null,
      task_type: task.taskType ?? null,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
    }

    expect(taskFromRow(row)).toMatchObject({
      status: 'blocked',
      priority: 'critical',
      blockerReason: 'Dependencia',
      title: task.title,
    })
  })

  it('distingue UUIDs sincronizables de IDs demo', () => {
    expect(isSupabaseId(task.id)).toBe(true)
    expect(isSupabaseId('task-1')).toBe(false)
  })
})
