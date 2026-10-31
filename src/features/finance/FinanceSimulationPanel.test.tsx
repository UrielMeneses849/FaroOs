import { fireEvent, render, screen } from '@testing-library/react'
import { addDays, format } from 'date-fns'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FinanceSimulationState } from '../../services/financeSimulation'
import type { FinanceData } from './financeTypes'
import { FinanceSimulationPanel } from './FinanceSimulationPanel'

const data = (): FinanceData => ({
  accounts: [{ id: 'bank', name: 'Banco', type: 'checking', currency: 'MXN', initialBalanceCents: 1_000_000, isActive: true, createdAt: '', updatedAt: '' }],
  categories: [], transactions: [], recurring: [], recurringOccurrences: [], budgets: [], goals: [], contributions: [], budgetClosures: [], savingsFundEntries: [], goalItems: [], liquidityPreference: { minimumOperatingBufferCents: 200_000 }, liquiditySnapshots: [],
})
const state = (): FinanceSimulationState => ({ version: 1, enabled: false, items: [{ id: 'laptop', kind: 'expense', description: 'Laptop de prueba', date: format(addDays(new Date(), 7), 'yyyy-MM-dd'), amountCents: 150_000, accountId: 'bank' }] })
const callbacks = () => ({ onSave: vi.fn(), onRemove: vi.fn(), onClear: vi.fn(), onOpenProjection: vi.fn() })

afterEach(() => vi.unstubAllGlobals())

describe('simulation editor navigation', () => {
  it('offers explicit activation for a paused scenario and keeps the existing callback contract', () => {
    const props = callbacks()
    const saved = state()
    const book = data()
    const original = structuredClone({ saved, book })
    const { rerender } = render(<FinanceSimulationPanel data={book} state={saved} {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Activar y ver impacto' }))
    expect(props.onOpenProjection).toHaveBeenCalledOnce()
    expect(props.onSave).not.toHaveBeenCalled()
    expect({ saved, book }).toEqual(original)
    rerender(<FinanceSimulationPanel data={book} state={{ ...saved, enabled: true }} {...props} />)
    expect(screen.getByRole('button', { name: 'Ver impacto en Proyecciones' })).toBeEnabled()
  })

  it('does not offer an impact from an empty scenario or dates that have already expired', () => {
    const props = callbacks()
    const saved = state()
    saved.items[0].date = format(addDays(new Date(), -1), 'yyyy-MM-dd')
    const { rerender } = render(<FinanceSimulationPanel data={data()} state={saved} {...props} />)
    expect(screen.getByRole('button', { name: 'Activar y ver impacto' })).toBeDisabled()
    rerender(<FinanceSimulationPanel data={data()} state={{ version: 1, enabled: false, items: [] }} {...props} />)
    expect(screen.getByRole('button', { name: 'Activar y ver impacto' })).toBeDisabled()
    expect(props.onOpenProjection).not.toHaveBeenCalled()
  })

  it('brings an edited mobile simulation back to its populated form without saving it', () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(max-width: 760px)', media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })))
    const props = callbacks()
    const saved = state()
    const original = structuredClone(saved)
    render(<FinanceSimulationPanel data={data()} state={saved} {...props} />)
    const form = screen.getByRole('form', { name: 'Movimiento simulado' })
    const scroll = vi.fn()
    Object.defineProperty(form, 'scrollIntoView', { configurable: true, value: scroll })
    fireEvent.click(screen.getByRole('button', { name: 'Editar simulación Laptop de prueba' }))
    expect(screen.getByLabelText('Nombre del movimiento')).toHaveFocus()
    expect(screen.getByLabelText('Nombre del movimiento')).toHaveValue('Laptop de prueba')
    expect(screen.getByLabelText('Monto simulado MXN')).toHaveValue(1500)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(props.onSave).not.toHaveBeenCalled()
    expect(saved).toEqual(original)
  })
})
