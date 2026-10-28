import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FinanceNavigation, type FinancePanel } from './FinanceNavigation'

function Harness() { const [value, setValue] = useState<FinancePanel>('overview'); return <FinanceNavigation value={value} onChange={setValue} onManageCategories={() => {}} /> }
describe('Finance section menu', () => {
  it('keeps the seven priorities visible in order and selects secondary sections through More', () => {
    render(<Harness />)
    expect(within(screen.getByRole('navigation', { name: 'Secciones financieras' })).getAllByRole('button').map(button => button.textContent)).toEqual(['Resumen', 'Proyecciones', 'Ingresos', 'Gastos', 'Plan', 'Movimientos', 'Presupuestos'])
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cuentas' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Más' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Metas' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Más: Metas' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Más: Metas' }))
    expect(screen.getByRole('menuitemradio', { name: 'Metas' })).toHaveAttribute('aria-checked', 'true')
  })
  it('supports arrows, Home, End, Escape and outside pointer dismissal', () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Más' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const menu = screen.getByRole('menu')
    expect(screen.getByRole('menuitemradio', { name: 'Ahorro' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'End' })
    expect(screen.getByRole('menuitem', { name: 'Gestionar categorías' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Home' })
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitemradio', { name: 'Metas' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
  it('opens category management and closes the menu', () => {
    const manage = vi.fn()
    render(<FinanceNavigation value="overview" onChange={() => {}} onManageCategories={manage} />)
    fireEvent.click(screen.getByRole('button', { name: 'Más' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Gestionar categorías' }))
    expect(manage).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
