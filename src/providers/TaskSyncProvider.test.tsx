import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const realtimeMocks = vi.hoisted(() => {
  const callbacks: Array<(payload: { eventType: string; new: unknown; old: unknown }) => void> = []
  const channel = { on: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() }
  channel.on.mockImplementation((_type, _filter, callback) => {
    callbacks.push(callback)
    return channel
  })
  channel.subscribe.mockImplementation((callback?: (status: string) => void) => {
    callback?.('SUBSCRIBED')
    return channel
  })
  return { callbacks, channel, removeChannel: vi.fn().mockResolvedValue('ok') }
})

vi.mock('../lib/supabase/client', () => ({
  supabase: {
    channel: vi.fn(() => realtimeMocks.channel),
    removeChannel: realtimeMocks.removeChannel,
  },
}))

vi.mock('../repositories/taskRepository', () => ({
  isSupabaseId: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
  taskRepository: repositoryMocks,
  taskFromRow: vi.fn((row) => ({
    id: row.id, title: row.title, description: row.description ?? undefined,
    notes: row.notes ?? undefined, area: row.area, status: row.status,
    priority: row.priority, workspaceId: row.workspace_id ?? undefined,
    createdAt: row.created_at, updatedAt: row.updated_at,
  })),
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
  signInTestLab: vi.fn().mockResolvedValue({ error: null }),
  signOut: vi.fn().mockResolvedValue({ error: null }),
}

function SyncProbe() {
  const sync = useTaskSync()
  return <span>{sync.state}</span>
}

describe('TaskSyncProvider', () => {
  beforeEach(() => {
    realtimeMocks.callbacks.length = 0
    useFaroStore.setState({ tasks: [] })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('hidrata y replica altas, cambios y eliminaciones en orden', async () => {
    const view = render(
      <AuthProvider service={authService}>
        <TaskSyncProvider><SyncProbe /></TaskSyncProvider>
      </AuthProvider>,
    )

    expect(await screen.findByText('ready')).toBeInTheDocument()
    expect(repositoryMocks.list).toHaveBeenCalledWith('user-1')
    expect(realtimeMocks.callbacks).toHaveLength(1)

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

    const realtime = realtimeMocks.callbacks[0]
    const remoteRow = {
      id, user_id: 'user-1', title: 'Tarea remota', description: null, notes: null,
      area: 'personal', status: 'todo', priority: 'medium', workspace_id: null,
      created_at: timestamp, updated_at: timestamp,
    }
    act(() => realtime({ eventType: 'INSERT', new: remoteRow, old: {} }))
    expect(useFaroStore.getState().tasks.find((task) => task.id === id)?.title).toBe('Tarea remota')

    act(() => realtime({ eventType: 'UPDATE', new: { ...remoteRow, title: 'Tarea actualizada', status: 'doing' }, old: {} }))
    expect(useFaroStore.getState().tasks.find((task) => task.id === id)).toEqual(expect.objectContaining({ title: 'Tarea actualizada', status: 'doing' }))

    act(() => realtime({ eventType: 'DELETE', new: {}, old: { id } }))
    expect(useFaroStore.getState().tasks.some((task) => task.id === id)).toBe(false)

    view.unmount()
    await waitFor(() => expect(realtimeMocks.removeChannel).toHaveBeenCalledWith(realtimeMocks.channel))
  })
})
