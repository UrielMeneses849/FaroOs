import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Task } from '../../types'
import { TaskKanbanBoard } from './TaskKanbanBoard'

const base: Task = { id: 'waiting-task', title: 'Validar reporte', status: 'waiting', waitingFor: 'Ana · revisión final', area: 'personal', priority: 'medium', createdAt: '', updatedAt: '' }
const props = { projects: [], showWorkspace: false, workspaceName: () => 'Personal', onMove: vi.fn(), onStatus: vi.fn(), onAdd: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() }

describe('columna de dependencias externas', () => {
  it('añade una quinta columna separada sin mover tareas de revisión', () => {
    render(<TaskKanbanBoard {...props} tasks={[base, { ...base, id: 'review-task', title: 'Revisar entrega', status: 'blocked' }]} />)
    expect(screen.getAllByRole('region').map(region => region.getAttribute('aria-label'))).toEqual(['Por hacer', 'En progreso', 'En espera', 'En revisión', 'Completado'])
    expect(within(screen.getByRole('region', { name: 'En espera' })).getByText('Validar reporte')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'En espera' })).getByText('Esperando: Ana · revisión final')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'En revisión' })).getByText('Revisar entrega')).toBeInTheDocument()
  })

  it('permite crear directamente en espera y explica su propósito cuando está vacía', async () => {
    const onAdd = vi.fn()
    render(<TaskKanbanBoard {...props} onAdd={onAdd} tasks={[]} />)
    expect(screen.getByText('Suelta aquí las tareas que dependen de otra persona.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Añadir tarea en En espera' }))
    expect(onAdd).toHaveBeenCalledWith('waiting')
  })
})
