import { beforeEach, describe, expect, it, vi } from 'vitest'
import { taskRepository } from './taskRepository'
import { TaskNotFoundError } from './taskErrors'
import type { Task } from '../types'

const mocks = vi.hoisted(() => {
  const query = { update: vi.fn(), insert: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), single: vi.fn() }
  for (const key of ['update', 'insert', 'select', 'eq'] as const) query[key].mockReturnValue(query)
  return { query, from: vi.fn(() => query) }
})
vi.mock('../lib/supabase/client', () => ({ supabase: { from: mocks.from } }))
const task: Task = {
  id: '550e8400-e29b-41d4-a716-446655440000', title: 'Reabrir copia local',
  area: 'personal', status: 'blocked', priority: 'medium', workspaceId: 'workspace-1',
  createdAt: '2026-10-14T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z',
}

describe('persistencia de tareas reabiertas', () => {
  beforeEach(() => vi.clearAllMocks())
  it('distingue una fila ausente de un fallo de red', async () => {
    mocks.query.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    await expect(taskRepository.updateStatus(task.id, 'blocked', 'user-1')).rejects.toBeInstanceOf(TaskNotFoundError)
    expect(mocks.query.eq).toHaveBeenCalledWith('user_id', 'user-1')
    const networkError = { message: 'Failed to fetch' }
    mocks.query.maybeSingle.mockResolvedValueOnce({ data: null, error: networkError })
    await expect(taskRepository.updateStatus(task.id, 'blocked', 'user-1')).rejects.toBe(networkError)
  })
  it('recupera con INSERT sin sobrescribir otra fila y limpia la fecha de cierre', async () => {
    mocks.query.maybeSingle.mockResolvedValueOnce({ data: { id: task.workspaceId }, error: null })
    mocks.query.single.mockResolvedValueOnce({ data: {
      ...task, user_id: 'user-1', workspace_id: task.workspaceId,
      created_at: task.createdAt, updated_at: task.updatedAt, completed_at: null,
    }, error: null })
    const restored = await taskRepository.restore(task, 'user-1')
    expect(mocks.from).toHaveBeenCalledWith('workspaces')
    expect(mocks.query.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: task.id, user_id: 'user-1', title: task.title, status: 'blocked', completed_at: null,
    }))
    expect(restored.status).toBe('blocked')
    expect(restored.completedAt).toBeUndefined()
  })
  it('no recupera una completada automáticamente', async () => {
    await expect(taskRepository.restore({ ...task, status: 'done' }, 'user-1')).rejects.toThrow('Solo se pueden recuperar')
    expect(mocks.query.insert).not.toHaveBeenCalled()
  })
})
