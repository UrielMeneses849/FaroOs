import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../../types'
import { TaskKanbanBoard } from './TaskKanbanBoard'

const base: Task = { id: 'task-a', title: 'Validar reporte', status: 'todo', area: 'personal', priority: 'medium', createdAt: '', updatedAt: '' }
const props = { projects: [], showWorkspace: false, workspaceName: () => 'Personal', onMove: vi.fn().mockResolvedValue(undefined), onStatus: vi.fn(), onAdd: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() }

// jsdom has no pointer events or layout. Supply browser-like pointer properties
// and deterministic five-column bounds, retaining the real dnd-kit sensors.
class TestPointerEvent extends MouseEvent {
  readonly isPrimary = true
  readonly pointerId = 1
  readonly pointerType = 'mouse'
}

async function startDrag(target: Element, x = 80, y = 120) {
  fireEvent.pointerDown(target, { clientX: x, clientY: y, button: 0, buttons: 1 })
  fireEvent.pointerMove(document, { clientX: x + 10, clientY: y, buttons: 1 })
  await waitFor(() => expect(document.querySelector('.kanban-card--drag-overlay')).toBeInTheDocument())
}

async function dropAt(x: number, y: number) {
  await act(async () => { fireEvent.pointerMove(document, { clientX: x, clientY: y, buttons: 1 }) })
  await act(async () => { fireEvent.pointerUp(document, { clientX: x, clientY: y, button: 0 }) })
}

describe('gestos reales del kanban', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('PointerEvent', TestPointerEvent)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const column = this.closest('.kanban-column')
      const index = ['todo', 'doing', 'waiting', 'blocked', 'done'].indexOf(column?.getAttribute('data-status') ?? 'todo')
      const x = Math.max(0, index) * 300
      if (this.matches('.kanban-column')) return new DOMRect(x, 0, 280, 600)
      if (this.matches('.kanban-column__list')) return new DOMRect(x, 60, 280, 540)
      if (this.matches('.kanban-card')) return new DOMRect(x + 10, this.textContent?.includes('Segunda tarea') ? 240 : 100, 260, 120)
      return new DOMRect(x + 20, 110, 180, 30)
    })
  })
  afterEach(async () => {
    cleanup()
    // dnd-kit removes its document click guard 50 ms after a drag finishes.
    // Let that listener detach before the next test clicks an action button.
    await new Promise(resolve => setTimeout(resolve, 60))
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('arrastra desde el título hasta una columna vacía de En espera', async () => {
    render(<TaskKanbanBoard {...props} tasks={[base]} />)
    await startDrag(screen.getByText(base.title))
    await dropAt(740, 350)
    expect(props.onMove).toHaveBeenCalledWith(base.id, 'waiting', undefined)
  })

  it('conserva el arrastre desde el asa y permite soltar en la cabecera', async () => {
    render(<TaskKanbanBoard {...props} tasks={[base]} />)
    await startDrag(screen.getByRole('button', { name: `Mover ${base.title}` }), 30, 120)
    await dropAt(440, 20)
    expect(props.onMove).toHaveBeenCalledWith(base.id, 'doing', undefined)
  })

  it('devuelve una completada a revisión con un único movimiento', async () => {
    const completed = { ...base, status: 'done' as const, completedAt: '2026-10-15T12:00:00.000Z' }
    render(<TaskKanbanBoard {...props} tasks={[completed]} />)
    await startDrag(screen.getByText(base.title), 1280, 120)
    await dropAt(1040, 350)
    expect(props.onMove).toHaveBeenCalledExactlyOnceWith(base.id, 'blocked', undefined)
    await waitFor(() => expect(document.querySelector('.kanban-card--drag-overlay')).not.toBeInTheDocument())
  })

  it('cancela con Escape sin mover la tarea', async () => {
    render(<TaskKanbanBoard {...props} tasks={[base]} />)
    await startDrag(screen.getByText(base.title))
    fireEvent.keyDown(document, { code: 'Escape', key: 'Escape' })
    expect(props.onMove).not.toHaveBeenCalled()
  })

  it('no inicia arrastre desde las acciones de editar y eliminar', async () => {
    const { unmount } = render(<TaskKanbanBoard {...props} tasks={[base]} />)
    fireEvent.pointerDown(screen.getByRole('button', { name: `Editar ${base.title}` }), { clientX: 220, clientY: 190, button: 0, buttons: 1 })
    fireEvent.pointerMove(document, { clientX: 600, clientY: 190, buttons: 1 })
    fireEvent.pointerUp(document, { clientX: 600, clientY: 190, button: 0 })
    expect(document.querySelector('.kanban-card--drag-overlay')).not.toBeInTheDocument()

    unmount()
    render(<TaskKanbanBoard {...props} tasks={[base]} />)
    fireEvent.click(screen.getByRole('button', { name: `Editar ${base.title}` }))
    await waitFor(() => expect(props.onEdit).toHaveBeenCalledWith(base))
  })
})
