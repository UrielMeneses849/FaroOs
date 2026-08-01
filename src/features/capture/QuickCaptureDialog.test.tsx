import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { useFaroStore } from '../../store'
import { QuickCaptureDialog } from './QuickCaptureDialog'

vi.mock('../../services/authService', () => ({
  authService: {
    getSession: vi.fn().mockResolvedValue({
      access_token: 'test-token',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'test-refresh-token',
      user: {
        id: 'user-1',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'uriel@example.com',
        created_at: '2026-07-24T00:00:00.000Z',
        app_metadata: {},
        user_metadata: {},
      },
    }),
    subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
    signIn: vi.fn().mockResolvedValue({ error: null }),
    signUp: vi.fn().mockResolvedValue({ error: null }),
    signInTestLab: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  },
}))

vi.mock('../../repositories/taskRepository', () => ({
  isSupabaseId: (id: string) => id.includes('-'),
  taskRepository: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(async (task) => task),
    update: vi.fn(async (task) => task),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../repositories/goalRepository', () => ({
  isSupabaseGoalId: (id: string) => id.includes('-'),
  goalRepository: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(async (goal) => goal),
    update: vi.fn(async (goal) => goal),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../repositories/projectRepository', () => ({
  isSupabaseProjectId: (id: string) => id.includes('-'),
  projectRepository: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(async (project) => project),
    update: vi.fn(async (project) => project),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../services/localDataMigrationService', () => ({
  localDataNeedsMigration: vi.fn().mockReturnValue(false),
  localDataMigrationService: {
    getReport: vi.fn().mockReturnValue({
      version: 1,
      migratedAt: '2026-07-24T00:00:00.000Z',
      migrated: {},
      pendingSchema: { ideas: 0, transactions: 0 },
    }),
    migrate: vi.fn(),
  },
}))

describe('captura rápida', () => {
  it('abre con Cmd + K', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(
      () => expect(document.querySelector('.dashboard-page')).toBeInTheDocument(),
      { timeout: 3000 },
    )
    await user.keyboard('{Meta>}k{/Meta}')
    expect(await screen.findByRole('dialog', { name: 'Captura rápida' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('¿Qué tienes en mente?')).toHaveFocus()
  })

  it('captura una idea en inbox', async () => {
    const user = userEvent.setup()
    render(<QuickCaptureDialog open onClose={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('¿Qué tienes en mente?'), 'Crear álbum de viaje')
    await user.keyboard('{Enter}')
    expect(useFaroStore.getState().ideas.some((idea) => idea.title === 'Crear álbum de viaje' && idea.status === 'inbox')).toBe(true)
    expect(screen.getByRole('status')).toHaveTextContent('Capturado')
  })

  it('captura una tarea con prioridad', async () => {
    const user = userEvent.setup()
    render(<QuickCaptureDialog open onClose={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('¿Qué tienes en mente?'), 'Revisar propuesta')
    await user.click(screen.getByRole('button', { name: 'Tarea' }))
    await user.selectOptions(screen.getByLabelText('Prioridad'), 'high')
    await user.click(screen.getByRole('button', { name: 'Guardar captura' }))
    expect(useFaroStore.getState().tasks.some((task) => task.title === 'Revisar propuesta' && task.priority === 'high' && task.status === 'todo')).toBe(true)
  })

  it('muestra errores Zod cuando falta el título', async () => {
    const user = userEvent.setup()
    render(<QuickCaptureDialog open onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Guardar captura' }))
    expect(screen.getByText('Escribe un título')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('¿Qué tienes en mente?')).toHaveAttribute('aria-invalid', 'true')
  })
})
