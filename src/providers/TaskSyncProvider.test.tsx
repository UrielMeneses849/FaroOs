import { render, screen, waitFor } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { useTaskSync } from '../hooks/useTaskSync'
import { useFaroStore } from '../store'
import type { AuthService } from '../services'
import { AuthProvider } from './AuthProvider'
import { TaskSyncProvider } from './TaskSyncProvider'

const repositoryMocks = vi.hoisted(() => ({
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn(async (task) => task),
  update: vi.fn(async (task) => task),
  remove: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../repositories/taskRepository', () => ({
  isSupabaseId: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
  taskRepository: repositoryMocks,
}))

const session = {
  access_token: 'token',
  token_type: 'bearer',
  expires_in: 3600,
  refresh_token: 'refresh',
  user: {
    id: 'user-1',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'uriel@example.com',
    created_at: '2026-07-24T00:00:00.000Z',
    app_metadata: {},
    user_metadata: {},
  },
} as Session

const authService: AuthService = {
  getSession: vi.fn().mockResolvedValue(session),
  subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
  signIn: vi.fn().mockResolvedValue({ error: null }),
  signUp: vi.fn().mockResolvedValue({ error: null }),
  signOut: vi.fn().mockResolvedValue({ error: null }),
}

function SyncProbe() {
  const sync = useTaskSync()
  return <span>{sync.state}</span>
}

describe('TaskSyncProvider', () => {
  it('hidrata y replica altas, cambios y eliminaciones en orden', async () => {
    render(
      <AuthProvider service={authService}>
        <TaskSyncProvider><SyncProbe /></TaskSyncProvider>
      </AuthProvider>,
    )

    expect(await screen.findByText('ready')).toBeInTheDocument()
    expect(repositoryMocks.list).toHaveBeenCalledWith('user-1')

    const timestamp = '2026-07-24T12:00:00.000Z'
    const id = '550e8400-e29b-41d4-a716-446655440000'
    useFaroStore.getState().createTask({
      id,
      title: 'Sincronizar tarea',
      area: 'personal',
      status: 'todo',
      priority: 'high',
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    await waitFor(() => expect(repositoryMocks.create).toHaveBeenCalled())

    useFaroStore.getState().updateTask(id, { status: 'done' })
    await waitFor(() =>
      expect(repositoryMocks.update).toHaveBeenCalledWith(
        expect.objectContaining({ id, status: 'done' }),
        'user-1',
      ),
    )

    useFaroStore.getState().deleteTask(id)
    await waitFor(() =>
      expect(repositoryMocks.remove).toHaveBeenCalledWith(id, 'user-1'),
    )
  })
})
