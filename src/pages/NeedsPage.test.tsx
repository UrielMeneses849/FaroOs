import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { blankProduct, emptyHousehold, type Household } from '../features/needs/household'
import { NeedsPage } from './NeedsPage'

let state: Household
const change = vi.fn(async (update: (s: Household) => Household) => { state = update(state) })
vi.mock('../hooks/useHousehold', () => ({ useHousehold: () => ({ state, loading: false, saving: false, readOnly: false, error: '', reload: vi.fn(), change }) }))

beforeEach(() => {
  change.mockClear()
  state = { ...emptyHousehold(), budgetCents: 150000, products: [
    { ...blankProduct(), id: 'rice', name: 'Arroz', stock: .3, target: 1, priceCents: 3200 },
    { ...blankProduct(), id: 'shampoo', name: 'Shampoo', department: 'care', mode: 'status', status: 'low', step: 1, purchaseUnit: 'botella' },
  ] }
})

describe('Necesidades weekly shopping', () => {
  it('warns about incomplete estimates and never treats unknown price as a completed checkout', async () => {
    const user = userEvent.setup()
    render(<NeedsPage />)
    expect(screen.getByText(/Falta precio en 1 producto/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Revisar lista del sábado' }))
    expect(screen.getByRole('button', { name: 'Cerrar compra y sumar al inventario' })).toBeDisabled()
    await user.type(screen.getByRole('spinbutton', { name: 'Precio de Shampoo' }), '80')
    expect(screen.getByRole('button', { name: 'Cerrar compra y sumar al inventario' })).toBeEnabled()
  })
  it('saving a plan changes estimated unit prices, but never stock or purchases', async () => {
    const user = userEvent.setup()
    render(<NeedsPage />)
    await user.click(screen.getByRole('button', { name: 'Revisar lista del sábado' }))
    const quantity = screen.getByRole('spinbutton', { name: 'Cantidad de Arroz' })
    await user.clear(quantity); await user.type(quantity, '2')
    await user.click(screen.getByRole('button', { name: 'Guardar lista sin comprar' }))
    expect(state.products[0].stock).toBe(.3)
    expect(state.products[0].plannedQuantity).toBe(2)
    expect(state.purchases).toHaveLength(0)
    expect(state.budgetCents).toBe(150000)
  })
  it('partial checkout adds only selected quantities and records the real total', async () => {
    const user = userEvent.setup()
    render(<NeedsPage />)
    await user.click(screen.getByRole('button', { name: 'Revisar lista del sábado' }))
    await user.click(screen.getByRole('checkbox', { name: 'Comprar Shampoo' }))
    await user.click(screen.getByRole('button', { name: 'Cerrar compra y sumar al inventario' }))
    expect(state.products[0].stock).toBe(1)
    expect(state.products[1].status).toBe('low')
    expect(state.purchases[0].totalCents).toBe(2240)
    expect(state.purchases[0].lines).toHaveLength(1)
  })
  it('mixed inventory records exact consumption and simple state changes', async () => {
    const user = userEvent.setup()
    render(<NeedsPage />)
    await user.click(screen.getByRole('button', { name: 'En casa' }))
    await user.click(screen.getByRole('button', { name: 'Usé…' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByRole('spinbutton'), '0.1')
    await user.click(within(dialog).getByRole('button', { name: 'Registrar consumo' }))
    expect(state.products[0].stock).toBe(.2)
    await user.click(screen.getByRole('button', { name: 'Se acabó' }))
    expect(state.products[1].status).toBe('empty')
    expect(state.purchases).toHaveLength(0)
  })
  it('edits the weekly household budget without a purchase', async () => {
    const user = userEvent.setup()
    render(<NeedsPage />)
    await user.click(screen.getByRole('button', { name: 'Editar presupuesto' }))
    const input = screen.getByRole('spinbutton')
    await user.clear(input); await user.type(input, '1800')
    await user.click(screen.getByRole('button', { name: 'Guardar presupuesto' }))
    expect(state.budgetCents).toBe(180000)
    expect(state.purchases).toHaveLength(0)
  })
})
