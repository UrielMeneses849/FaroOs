import { describe, expect, it } from 'vitest'
import type { Database } from '../types/database.types'
import type { Project } from '../types'
import {
  isSupabaseProjectId,
  projectFromRow,
  projectToInsert,
  projectToUpdate,
} from './projectRepository'

const project: Project = {
  id: '550e8400-e29b-41d4-a716-446655440002',
  title: 'Projects en Supabase',
  description: 'Conectar el tercer dominio',
  area: 'personal',
  status: 'completed',
  priority: 'high',
  goalId: '550e8400-e29b-41d4-a716-446655440001',
  workspaceId: '550e8400-e29b-41d4-a716-446655440010',
  startDate: '2026-07-24',
  endDate: '2026-08-15',
  createdAt: '2026-07-24T10:00:00.000Z',
  updatedAt: '2026-07-24T11:00:00.000Z',
}

describe('projectRepository mappers', () => {
  it('convierte Projects incluyendo su relación UUID con Goal', () => {
    expect(projectToInsert(project, 'user-1')).toMatchObject({
      id: project.id,
      user_id: 'user-1',
      goal_id: project.goalId,
      start_date: project.startDate,
      target_date: project.endDate,
      completed_at: project.updatedAt,
      archived_at: null,
      priority: 'high',
      workspace_id: project.workspaceId,
    })
  })

  it('omite relaciones demo y limpia completed_at al reactivar', () => {
    expect(projectToUpdate({
      ...project,
      status: 'active',
      goalId: 'goal-local',
    })).toMatchObject({
      status: 'active',
      goal_id: null,
      completed_at: null,
    })
  })

  it('normaliza fechas remotas y usa prioridad local por defecto', () => {
    const row: Database['public']['Tables']['projects']['Row'] = {
      id: project.id,
      user_id: 'user-1',
      title: project.title,
      description: project.description ?? null,
      area: project.area,
      status: project.status,
      goal_id: project.goalId ?? null,
      start_date: '2026-07-24T00:00:00.000Z',
      target_date: '2026-08-15T00:00:00.000Z',
      completed_at: project.updatedAt,
      archived_at: null,
      priority: 'high',
      workspace_id: project.workspaceId ?? null,
      created_at: project.createdAt,
      updated_at: project.updatedAt,
    }

    expect(projectFromRow(row)).toMatchObject({
      startDate: '2026-07-24',
      endDate: '2026-08-15',
      priority: 'high',
      workspaceId: project.workspaceId,
    })
  })

  it('no sincroniza IDs demo', () => {
    expect(isSupabaseProjectId(project.id)).toBe(true)
    expect(isSupabaseProjectId('project-faro')).toBe(false)
  })
})
