import { describe, expect, it } from 'vitest'
import type { Database } from '../types/database.types'
import type { Goal } from '../types'
import {
  goalFromRow,
  goalToInsert,
  goalToUpdate,
  isSupabaseGoalId,
} from './goalRepository'

const goal: Goal = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  title: 'Lanzar FARO',
  description: 'Preparar la siguiente etapa',
  area: 'personal',
  status: 'completed',
  targetDate: '2026-09-30',
  projectIds: ['project-local'],
  workspaceId: '550e8400-e29b-41d4-a716-446655440010',
  createdAt: '2026-07-24T10:00:00.000Z',
  updatedAt: '2026-07-24T11:00:00.000Z',
}

describe('goalRepository mappers', () => {
  it('convierte un objetivo local al esquema Supabase', () => {
    expect(goalToInsert(goal, 'user-1')).toMatchObject({
      id: goal.id,
      user_id: 'user-1',
      title: goal.title,
      status: 'completed',
      target_date: goal.targetDate,
      completed_at: goal.updatedAt,
      archived_at: null,
      workspace_id: goal.workspaceId,
    })
  })

  it('limpia completed_at al reactivar un objetivo', () => {
    expect(goalToUpdate({ ...goal, status: 'active' })).toMatchObject({
      status: 'active',
      completed_at: null,
    })
  })

  it('normaliza fechas remotas y conserva Projects como relación local', () => {
    const row: Database['public']['Tables']['goals']['Row'] = {
      id: goal.id,
      user_id: 'user-1',
      title: goal.title,
      description: goal.description ?? null,
      area: goal.area,
      status: goal.status,
      target_date: '2026-09-30T00:00:00.000Z',
      completed_at: goal.updatedAt,
      archived_at: null,
      workspace_id: goal.workspaceId ?? null,
      created_at: goal.createdAt,
      updated_at: goal.updatedAt,
    }

    expect(goalFromRow(row)).toMatchObject({
      targetDate: '2026-09-30',
      projectIds: [],
      workspaceId: goal.workspaceId,
    })
  })

  it('no intenta sincronizar IDs demo', () => {
    expect(isSupabaseGoalId(goal.id)).toBe(true)
    expect(isSupabaseGoalId('goal-faro')).toBe(false)
  })
})
