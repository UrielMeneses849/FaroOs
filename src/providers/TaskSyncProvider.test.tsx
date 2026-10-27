import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTaskSync } from '../hooks/useTaskSync'
import { useFaroStore } from '../store'
import type { AuthService } from '../services'
import type { Task } from '../types'
import { TaskNotFoundError } from '../repositories/taskErrors'
import { AuthProvider } from './AuthProvider'
import { TaskSyncProvider } from './TaskSyncProvider'
import { shouldUploadMissingLocalTask } from './taskSyncPolicy'

const repositoryMocks = vi.hoisted(() => ({
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn(async (task) => task),
  update: vi.fn(async (task) => task),
  updateStatus: vi.fn(async (): Promise<Task | undefined> => undefined),
  restore: vi.fn(async (task) => task),
  remove: vi.fn().mockResolvedValue(undefined),
  runSmartCleaner: vi.fn().mockResolvedValue({ cleanedIds: [], scanned: 0, eligible: 0, cleaned: 0, skippedMissingCompletedAt: 0, errors: 0 }),
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
      expect(repositoryMocks.updateStatus).toHaveBeenCalledWith(id, 'done', 'user-1', undefined),
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

  it('recupera una completada que solo queda en caché y persiste su reapertura al recargar', async () => {
    const task: Task = {
      id: '550e8400-e29b-41d4-a716-446655440000', title: 'Completada retirada por el limpiador',
      area: 'personal', status: 'done', priority: 'medium', workspaceId: 'workspace-1',
      completedAt: '2026-10-15T12:00:00.000Z',
      createdAt: '2026-10-14T12:00:00.000Z', updatedAt: '2026-10-15T12:00:00.000Z',
    }
    useFaroStore.setState({ tasks: [task] })
    repositoryMocks.list.mockResolvedValueOnce([])
    repositoryMocks.updateStatus.mockRejectedValueOnce(new TaskNotFoundError())
    const view = render(<AuthProvider service={authService}><TaskSyncProvider><SyncProbe /></TaskSyncProvider></AuthProvider>)
    await screen.findByText('ready')
    expect(repositoryMocks.create).not.toHaveBeenCalled()
    act(() => useFaroStore.getState().updateTask(task.id, { status: 'blocked', sortOrder: 1000 }))
    await waitFor(() => expect(repositoryMocks.restore).toHaveBeenCalledWith(expect.objectContaining({
      id: task.id, title: task.title, workspaceId: task.workspaceId, status: 'blocked', completedAt: undefined, sortOrder: 1000,
    }), 'user-1'))
    await screen.findByText('ready')
    const saved = useFaroStore.getState().tasks[0]
    expect(saved.status).toBe('blocked')
    expect(repositoryMocks.updateStatus).toHaveBeenCalledTimes(1)
    view.unmount()
    useFaroStore.setState({ tasks: [] })
    repositoryMocks.list.mockResolvedValueOnce([saved])
    render(<AuthProvider service={authService}><TaskSyncProvider><SyncProbe /></TaskSyncProvider></AuthProvider>)
    await screen.findByText('ready')
    expect(useFaroStore.getState().tasks[0]).toEqual(saved)
    expect(repositoryMocks.restore).toHaveBeenCalledTimes(1)
  })

  it('no recupera tareas por errores de red ni recrea una tarea activa eliminada', async () => {
    const task: Task = {
      id: '550e8400-e29b-41d4-a716-446655440000', title: 'Tarea activa',
      area: 'personal', status: 'doing', priority: 'medium',
      createdAt: '2026-10-19T12:00:00.000Z', updatedAt: '2026-10-19T12:00:00.000Z',
    }
    repositoryMocks.list.mockResolvedValueOnce([task])
    repositoryMocks.updateStatus.mockRejectedValueOnce(new TaskNotFoundError())
    render(<AuthProvider service={authService}><TaskSyncProvider><SyncProbe /></TaskSyncProvider></AuthProvider>)
    await screen.findByText('ready')
    act(() => useFaroStore.getState().updateTask(task.id, { status: 'blocked' }))
    await screen.findByText('error')
    expect(repositoryMocks.restore).not.toHaveBeenCalled()
    expect(useFaroStore.getState().tasks[0]).toEqual(task)
  })

  it('restaura una reapertura fallida una sola vez sin volver a guardarla', async () => {
    const task = {
      id: '550e8400-e29b-41d4-a716-446655440000', title: 'Reabrir tarea',
      area: 'personal' as const, status: 'done' as const, priority: 'medium' as const,
      completedAt: '2026-10-19T12:00:00.000Z',
      createdAt: '2026-10-19T12:00:00.000Z', updatedAt: '2026-10-19T12:00:00.000Z',
    }
    repositoryMocks.list.mockResolvedValueOnce([task])
    repositoryMocks.updateStatus.mockRejectedValueOnce(new Error('Cannot coerce the result to a single JSON object'))
    render(<AuthProvider service={authService}><TaskSyncProvider><SyncProbe /></TaskSyncProvider></AuthProvider>)
    await screen.findByText('ready')

    act(() => useFaroStore.getState().updateTask(task.id, { status: 'blocked' }))
    await screen.findByText('error')
    // Drain queued work: rollback must not enqueue a second status request.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
    expect(repositoryMocks.updateStatus).toHaveBeenCalledTimes(1)
    expect(repositoryMocks.restore).not.toHaveBeenCalled()
    expect(useFaroStore.getState().tasks).toEqual([task])
  })

  it('ignora ecos antiguos mientras guarda y confirma la reapertura sin parpadear', async () => {
    const task = {
      id: '550e8400-e29b-41d4-a716-446655440000', title: 'Reabrir tarea',
      area: 'personal' as const, status: 'done' as const, priority: 'medium' as const,
      completedAt: '2026-10-19T12:00:00.000Z',
      createdAt: '2026-10-19T12:00:00.000Z', updatedAt: '2026-10-19T12:00:00.000Z',
    }
    repositoryMocks.list.mockResolvedValueOnce([task])
    let finish!: (value: Task | undefined) => void
    repositoryMocks.updateStatus.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    render(<AuthProvider service={authService}><TaskSyncProvider><SyncProbe /></TaskSyncProvider></AuthProvider>)
    await screen.findByText('ready')
    act(() => useFaroStore.getState().updateTask(task.id, { status: 'blocked' }))
    await waitFor(() => expect(repositoryMocks.updateStatus).toHaveBeenCalledTimes(1))
    act(() => realtimeMocks.callbacks[0]({ eventType: 'UPDATE', new: {
      ...task, created_at: task.createdAt, updated_at: task.updatedAt,
    }, old: {} }))
    expect(useFaroStore.getState().tasks[0].status).toBe('blocked')
    const saved = { ...useFaroStore.getState().tasks[0], updatedAt: '2099-01-01T00:00:00.000Z' }
    await act(async () => finish(saved))
    await screen.findByText('ready')
    act(() => realtimeMocks.callbacks[0]({ eventType: 'UPDATE', new: {
      ...task, created_at: task.createdAt, updated_at: task.updatedAt,
    }, old: {} }))
    expect(useFaroStore.getState().tasks[0]).toEqual(saved)
    expect(repositoryMocks.updateStatus).toHaveBeenCalledTimes(1)
  })

  it('un fallo anterior no deshace una edición posterior ni otra tarea', async () => {
    const task = {
      id: '550e8400-e29b-41d4-a716-446655440000', title: 'Reabrir tarea',
      area: 'personal' as const, status: 'done' as const, priority: 'medium' as const,
      createdAt: '2026-10-19T12:00:00.000Z', updatedAt: '2026-10-19T12:00:00.000Z',
    }
    const other = { ...task, id: '550e8400-e29b-41d4-a716-446655440001' }
    repositoryMocks.list.mockResolvedValueOnce([task, other])
    let fail!: (reason: Error) => void
    repositoryMocks.updateStatus.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    render(<AuthProvider service={authService}><TaskSyncProvider><SyncProbe /></TaskSyncProvider></AuthProvider>)
    await screen.findByText('ready')
    act(() => useFaroStore.getState().updateTask(task.id, { status: 'blocked' }))
    await waitFor(() => expect(repositoryMocks.updateStatus).toHaveBeenCalledTimes(1))
    act(() => {
      useFaroStore.getState().updateTask(task.id, { status: 'doing' })
      useFaroStore.getState().updateTask(other.id, { status: 'todo' })
    })
    await act(async () => fail(new Error('Fallo de red')))
    await waitFor(() => expect(repositoryMocks.updateStatus).toHaveBeenCalledTimes(3))
    await screen.findByText('ready')
    expect(useFaroStore.getState().tasks.find(item => item.id === task.id)?.status).toBe('doing')
    expect(useFaroStore.getState().tasks.find(item => item.id === other.id)?.status).toBe('todo')
  })

  it('carga el Backlog aunque el Smart Cleaner opcional no esté disponible', async () => {
    const id = '550e8400-e29b-41d4-a716-446655440000'
    repositoryMocks.runSmartCleaner.mockRejectedValueOnce(new Error('RPC no disponible'))
    repositoryMocks.list.mockResolvedValueOnce([{
      id,
      title: 'Tarea remota existente',
      area: 'personal',
      status: 'todo',
      priority: 'medium',
      workspaceId: 'workspace-1',
      createdAt: '2026-08-16T12:00:00.000Z',
      updatedAt: '2026-08-16T12:00:00.000Z',
    }])

    render(
      <AuthProvider service={authService}>
        <TaskSyncProvider><SyncProbe /></TaskSyncProvider>
      </AuthProvider>,
    )

    expect(await screen.findByText('ready')).toBeInTheDocument()
    expect(useFaroStore.getState().tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id, title: 'Tarea remota existente' }),
    ]))
  })

  it('no resucita una tarea completada antigua que el limpiador ya borró', async () => {
    const oldCompletedTask = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Completada histórica',
      area: 'personal' as const,
      status: 'done' as const,
      priority: 'medium' as const,
      workspaceId: 'workspace-1',
      completedAt: '2026-07-29T12:00:00.000Z',
      createdAt: '2026-07-28T12:00:00.000Z',
      updatedAt: '2026-07-29T12:00:00.000Z',
    }
    useFaroStore.setState({ tasks: [oldCompletedTask] })
    repositoryMocks.list.mockResolvedValueOnce([])

    render(
      <AuthProvider service={authService}>
        <TaskSyncProvider><SyncProbe /></TaskSyncProvider>
      </AuthProvider>,
    )

    expect(await screen.findByText('ready')).toBeInTheDocument()
    expect(shouldUploadMissingLocalTask(oldCompletedTask, new Date('2026-10-08T12:00:00.000Z').getTime())).toBe(false)
    expect(repositoryMocks.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: oldCompletedTask.id }),
      'user-1',
    )
  })
})
