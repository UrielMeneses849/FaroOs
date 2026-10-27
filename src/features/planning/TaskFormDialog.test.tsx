import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskFormDialog } from './PlanningDialogs'

const storeMocks = vi.hoisted(() => ({ createTask: vi.fn(), updateTask: vi.fn() }))
vi.mock('../../store', () => {
  const state = { projects: [{ id: 'project-faro', title: 'FARO OS', workspaceId: 'workspace-personal', area: 'personal', status: 'active', priority: 'medium', createdAt: '', updatedAt: '' }], createTask: storeMocks.createTask, updateTask: storeMocks.updateTask }
  return { useFaroStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), { getState: () => state }) }
})

vi.mock('../../hooks/useWorkspaces', () => ({
  useWorkspaces: () => ({
    data: [{ id: 'workspace-personal', name: 'Personal', type: 'personal', isActive: true, sortOrder: 0, createdAt: '', updatedAt: '' }],
    loading: false,
  }),
}))

vi.mock('../../hooks/useBacklogSections', () => ({
  useBacklogSections: () => ({ data: [{ id: 'section-explorer', workspaceId: 'workspace-personal', name: 'Explorer', color: '#5b8cff', sortOrder: 0, createdAt: '', updatedAt: '' }], loading: false, error: null, refresh: vi.fn() }),
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
    expect(screen.getByRole('combobox', { name: /proyecto/i })).toBeInTheDocument()
    expect(screen.queryByText('Notas')).not.toBeInTheDocument()
    expect(screen.queryByText(/Notas de revisión/)).not.toBeInTheDocument()
    expect(screen.queryByText('Pausada hasta')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Estado' }))
    await user.click(screen.getByRole('menuitem', { name: /en revisión/i }))
    expect(screen.getByText(/Notas de revisión/)).toBeInTheDocument()
  })

  it('crea una tarea en espera con la dependencia indicada', async () => {
    const user = userEvent.setup()
    render(<TaskFormDialog open status="waiting" workspaceId="workspace-personal" onClose={vi.fn()} />)
    await user.type(screen.getByRole('textbox', { name: 'Título' }), 'Validar reporte')
    await user.type(screen.getByRole('textbox', { name: /qué o a quién estás esperando/i }), 'Ana · aprobación del reporte')
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }))
    expect(storeMocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ status: 'waiting', waitingFor: 'Ana · aprobación del reporte' }))
  })

  it('conserva la dependencia al editar una tarea existente', async () => {
    const user = userEvent.setup()
    render(<TaskFormDialog open initial={{ id: 'waiting-task', title: 'Validar reporte', status: 'waiting', waitingFor: 'Ana · aprobación', area: 'personal', priority: 'medium', workspaceId: 'workspace-personal', createdAt: '', updatedAt: '' }} onClose={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: /qué o a quién estás esperando/i })).toHaveValue('Ana · aprobación')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(storeMocks.updateTask).toHaveBeenCalledWith('waiting-task', expect.objectContaining({ status: 'waiting', waitingFor: 'Ana · aprobación' }))
  })

  it('guarda sección y tipo para organizar el backlog', async () => {
    const user = userEvent.setup()
    render(<TaskFormDialog open workspaceId="workspace-personal" onClose={vi.fn()} />)
    await user.type(screen.getByRole('textbox', { name: 'Título' }), 'Ajustar filtros')
    await user.selectOptions(screen.getByRole('combobox', { name: /sección/i }), 'section-explorer')
    await user.selectOptions(screen.getByRole('combobox', { name: /tipo de tarea/i }), 'ui')
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }))
    expect(storeMocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ sectionId: 'section-explorer', taskType: 'ui' }))
  })

  it('crea un bug con resultado, reproducción y criterios en la descripción existente', async () => {
    const user = userEvent.setup()
    render(<TaskFormDialog open workspaceId="workspace-personal" onClose={vi.fn()} />)
    await user.type(screen.getByRole('textbox', { name: 'Título' }), 'Corregir selección')
    await user.type(screen.getByRole('textbox', { name: /objetivo \/ resultado esperado/i }), 'Vaciar la selección al limpiar filtros')
    await user.selectOptions(screen.getByRole('combobox', { name: /tipo de tarea/i }), 'bug')
    await user.click(screen.getByText(/detalles para ejecutar/i))
    await user.type(screen.getByRole('textbox', { name: /contexto \/ comportamiento actual/i }), 'Los puntos quedan en caché')
    await user.type(screen.getByRole('textbox', { name: /pasos para reproducir/i }), 'Seleccionar puntos y limpiar filtros')
    await user.type(screen.getByRole('textbox', { name: /criterios de aceptación/i }), 'La selección queda vacía')
    await user.selectOptions(screen.getByRole('combobox', { name: /proyecto/i }), 'project-faro')
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }))
    expect(storeMocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-faro',
      description: expect.stringContaining('## Pasos para reproducir'),
    }))
    expect(storeMocks.createTask.mock.calls[0][0].description).toContain('## Criterios de aceptación')
  })

  it('conserva una descripción antigua como contexto al editar', async () => {
    const user = userEvent.setup()
    render(<TaskFormDialog open initial={{ id: 'legacy-task', title: 'Tarea anterior', description: 'Texto previo sin estructura', status: 'todo', area: 'personal', priority: 'medium', workspaceId: 'workspace-personal', createdAt: '', updatedAt: '' }} onClose={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: /contexto \/ comportamiento actual/i })).toHaveValue('Texto previo sin estructura')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(storeMocks.updateTask).toHaveBeenCalledWith('legacy-task', expect.objectContaining({ description: expect.stringContaining('Texto previo sin estructura') }))
  })

  it('copia un encargo explícito para dot sin afirmar que fue enviado', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<TaskFormDialog open initial={{ id: 'task-copy', title: 'Preparar entrega', description: 'Comportamiento actual', status: 'todo', area: 'personal', priority: 'high', workspaceId: 'workspace-personal', sectionId: 'section-explorer', createdAt: '', updatedAt: '' }} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /copiar encargo para dot/i }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('- ID: task-copy'))
    expect(writeText.mock.calls[0][0]).toContain('No ha sido enviado ni iniciado automáticamente')
    expect(screen.getByRole('button', { name: /encargo copiado/i })).toBeInTheDocument()
  })
})
