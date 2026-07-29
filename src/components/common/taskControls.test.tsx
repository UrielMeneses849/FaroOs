import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { format } from 'date-fns'
import { describe, expect, it, vi } from 'vitest'
import { StatusSelector } from './StatusSelector'
import { TaskDatePicker } from './TaskDatePicker'

describe('controles compactos de tarea', () => {
  it('selecciona Hoy sin convertir la fecha local a UTC', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TaskDatePicker value="" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /sin fecha/i }))
    await user.click(screen.getByRole('button', { name: 'Hoy' }))
    expect(onChange).toHaveBeenCalledWith(format(new Date(), 'yyyy-MM-dd'))
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
})
