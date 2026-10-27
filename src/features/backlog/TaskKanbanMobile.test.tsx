import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Task } from '../../types'
import { TaskKanbanBoard } from './TaskKanbanBoard'

const task: Task = { id: 'task-mobile', title: 'Confirmar entrega', status: 'todo', area: 'personal', priority: 'medium', createdAt: '', updatedAt: '' }
const props = { projects: [], showWorkspace: false, workspaceName: () => 'Personal', onMove: vi.fn().mockResolvedValue(undefined), onStatus: vi.fn(), onAdd: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() }

describe('navegación móvil del backlog', () => {
  it('permite ir a un estado vacío y crear una tarea en ese estado', async () => {
    const onAdd = vi.fn()
    render(<TaskKanbanBoard {...props} onAdd={onAdd} tasks={[task]} />)
    const filters = screen.getByRole('navigation', { name: 'Filtrar tareas por estado' })
    const waiting = within(filters).getByRole('button', { name: /En espera/ })
    waiting.focus()
    await userEvent.keyboard('{Enter}')
    expect(waiting).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: 'En espera' })).toHaveAttribute('data-mobile-active', 'true')
    expect(screen.getByRole('region', { name: 'Por hacer' })).toHaveAttribute('data-mobile-active', 'false')
    await userEvent.click(within(screen.getByRole('region', { name: 'En espera' })).getByRole('button', { name: 'Añadir tarea en En espera' }))
    expect(onAdd).toHaveBeenCalledExactlyOnceWith('waiting')
  })

  it('cuenta las tareas sin clasificar y pausadas dentro de Por hacer', () => {
    render(<TaskKanbanBoard {...props} tasks={[task, { ...task, id: 'inbox', status: 'inbox' }, { ...task, id: 'paused', status: 'paused' }]} />)
    const filters = screen.getByRole('navigation', { name: 'Filtrar tareas por estado' })
    expect(within(filters).getByRole('button', { name: /Por hacer/ })).toHaveTextContent('3')
  })
})
