import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { format } from 'date-fns'
import { describe, expect, it, vi } from 'vitest'
import { StatusSelector } from './StatusSelector'
import { TaskDatePicker } from './TaskDatePicker'
import { Modal } from './Modal'

describe('controles compactos de tarea', () => {
  it('selecciona Hoy sin convertir la fecha local a UTC', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TaskDatePicker value="" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /sin fecha/i }))
    await user.click(screen.getByRole('button', { name: 'Hoy' }))
    expect(onChange).toHaveBeenCalledWith(format(new Date(), 'yyyy-MM-dd'))
    expect(screen.getByRole('button', { name: /sin fecha/i })).toHaveFocus()
  })

  it('cambia el estado desde el menú reutilizable', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<StatusSelector value="todo" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /por hacer/i }))
    await user.click(screen.getByRole('menuitem', { name: /en progreso/i }))
    expect(onChange).toHaveBeenCalledWith('doing')
  })

  it('mantiene un solo menú abierto y cierra con Escape o clic fuera', async () => {
    const user = userEvent.setup()
    render(<div><StatusSelector value="todo" onChange={vi.fn()} /><StatusSelector value="doing" onChange={vi.fn()} /><button>Fuera</button></div>)
    const triggers = screen.getAllByRole('button', { name: /por hacer|en progreso/i })
    await user.click(triggers[0])
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    await user.click(triggers[1])
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(triggers[0])
    await user.click(screen.getByRole('button', { name: 'Fuera' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('permite poner una tarea en espera sin convertirla en bloqueada', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<StatusSelector value="doing" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /en progreso/i }))
    await user.click(screen.getByRole('menuitem', { name: 'En espera' }))
    expect(onChange).toHaveBeenCalledWith('waiting')
  })

  it('muestra En revisión y conserva el valor blocked del backend', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<StatusSelector value="doing" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /en progreso/i }))
    await user.click(screen.getByRole('menuitem', { name: 'En revisión' }))
    expect(onChange).toHaveBeenCalledWith('blocked')
  })

  it('mantiene el menú en una capa global al hacer scroll', async () => {
    const user = userEvent.setup()
    render(<StatusSelector value="todo" onChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /por hacer/i }))
    const menu = screen.getByRole('menu')
    expect(menu.parentElement).toBe(document.body)
    fireEvent.scroll(window)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('recorre los estados con flechas, Inicio y Fin y selecciona con Enter', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    render(<StatusSelector value="waiting" onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: 'En espera' })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Por hacer' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'En progreso' })).toHaveFocus()
    await user.keyboard('{End}{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Por hacer' })).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Completada' })).toHaveFocus()
    await user.keyboard('{Home}{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('doing')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Completada' })).toHaveFocus()
  })

  it('Escape cierra sólo el menú antes de cerrar el modal que lo contiene', async () => {
    const user = userEvent.setup(), onClose = vi.fn()
    render(<Modal open title="Editar tarea" onClose={onClose}><StatusSelector value="todo" onChange={vi.fn()} /><button>Guardar</button></Modal>)
    const trigger = screen.getByRole('button', { name: 'Por hacer' })
    await user.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'Por hacer' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Editar tarea' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })


  it('Escape cierra el calendario anidado y conserva el formulario', async () => {
    const user = userEvent.setup(), onClose = vi.fn()
    render(<Modal open title="Editar tarea" onClose={onClose}><TaskDatePicker value="" onChange={vi.fn()} /></Modal>)
    const trigger = screen.getByRole('button', { name: 'Sin fecha' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Seleccionar fecha' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Seleccionar fecha' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Editar tarea' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('revela el calendario abierto dentro del scroll del modal sin moverlo a un portal', async () => {
    const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    const reveal = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: reveal })
    try {
      const user = userEvent.setup()
      render(<Modal open title="Editar tarea" onClose={vi.fn()}><TaskDatePicker value="" onChange={vi.fn()} /></Modal>)
      await user.click(screen.getByRole('button', { name: 'Sin fecha' }))
      const calendar = screen.getByRole('dialog', { name: 'Seleccionar fecha' })
      expect(calendar.closest('.modal-body')).not.toBeNull()
      expect(reveal).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
    } finally {
      if (previous) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', previous)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  it('abre el calendario aunque scrollIntoView no esté disponible', async () => {
    const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: undefined })
    try {
      const user = userEvent.setup()
      render(<Modal open title="Editar tarea" onClose={vi.fn()}><TaskDatePicker value="" onChange={vi.fn()} /></Modal>)
      await user.click(screen.getByRole('button', { name: 'Sin fecha' }))
      expect(screen.getByRole('dialog', { name: 'Seleccionar fecha' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Hoy' })).toBeInTheDocument()
    } finally {
      if (previous) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', previous)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  it('Tab cierra el menú y continúa con el siguiente control del formulario', async () => {
    const user = userEvent.setup()
    render(<Modal open title="Editar tarea" onClose={vi.fn()}><StatusSelector value="todo" onChange={vi.fn()} /><button>Guardar</button></Modal>)
    await user.click(screen.getByRole('button', { name: 'Por hacer' }))
    await user.keyboard('{Tab}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar' })).toHaveFocus()
  })
})
