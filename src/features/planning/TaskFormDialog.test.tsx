import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskFormDialog } from './PlanningDialogs'

const storeMocks = vi.hoisted(() => ({ createTask: vi.fn(), updateTask: vi.fn() }))
vi.mock('../../store', () => {
  const state = { projects: [], createTask: storeMocks.createTask, updateTask: storeMocks.updateTask }
  return { useFaroStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), { getState: () => state }) }
})

vi.mock('../../hooks/useWorkspaces', () => ({
  useWorkspaces: () => ({
    data: [{ id: 'workspace-personal', name: 'Personal', type: 'personal', isActive: true, sortOrder: 0, createdAt: '', updatedAt: '' }],
    loading: false,
  }),
}))

describe('modal compacto de tareas', () => {
  beforeEach(() => {
    storeMocks.createTask.mockReset()
    storeMocks.updateTask.mockReset()
  })

  it('bloquea envíos repetidos desde el primer submit y cierra al terminar', async () => {
    let finishSecondarySave: () => void = () => undefined
    const secondarySave = new Promise<void>((resolve) => { finishSecondarySave = () => resolve() })
    const onClose = vi.fn()
    render(<TaskFormDialog open workspaceId="workspace-personal" onSaved={() => secondarySave} onClose={onClose} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Título' }), 'Tarea única')
    const form = screen.getByRole('button', { name: 'Crear tarea' }).closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(storeMocks.createTask).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Creando…' })).toBeDisabled()
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => finishSecondarySave())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('cierra después de crear aunque falle una operación secundaria', async () => {
    const onClose = vi.fn()
    const onSavedError = vi.fn()
    render(<TaskFormDialog open workspaceId="workspace-personal" onSaved={() => Promise.reject(new Error('focus failed'))} onSavedError={onSavedError} onClose={onClose} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Título' }), 'Tarea persistida')
    await userEvent.click(screen.getByRole('button', { name: 'Crear tarea' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(storeMocks.createTask).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onSavedError).toHaveBeenCalledTimes(1))
  })

  it('oculta campos secundarios y muestra bloqueo solo cuando aplica', async () => {
    const user = userEvent.setup()
    render(<TaskFormDialog open workspaceId="workspace-personal" onClose={() => undefined} />)
    expect(screen.queryByText('Stakeholder')).not.toBeInTheDocument()
    expect(screen.queryByText('Esperando a')).not.toBeInTheDocument()
    expect(screen.queryByText('Área')).not.toBeInTheDocument()
    expect(screen.queryByText('Objetivo')).not.toBeInTheDocument()
    expect(screen.queryByText('Proyecto')).not.toBeInTheDocument()
    expect(screen.queryByText('Notas')).not.toBeInTheDocument()
    expect(screen.queryByText('Motivo de bloqueo')).not.toBeInTheDocument()
    expect(screen.queryByText('Pausada hasta')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Estado' }))
    await user.click(screen.getByRole('menuitem', { name: /bloqueada/i }))
    expect(screen.getByText('Motivo de bloqueo')).toBeInTheDocument()
  })
})
