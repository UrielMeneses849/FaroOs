import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FinanceDecisionTools } from './FinanceDecisionTools'
import type { FinanceData } from './financeTypes'
import { buildFinanceDecisionReport } from '../../services/financeDecisionTools'
import { captureFinanceForecastJournal } from '../../services/financeForecastJournal'

const reference = new Date(2026, 9, 31, 12)
const storageKey = (user: string) => `faro-finance-provisions:v1:${user}`

function fixture(): FinanceData {
  return {
    accounts: [{ id: 'bank', name: 'Banco', type: 'checking', currency: 'MXN', initialBalanceCents: 1_000_000, isActive: true, createdAt: '', updatedAt: '' }],
    categories: [],
    transactions: [
      { id: 'salary', accountId: 'bank', type: 'income', amountCents: 500_000, transactionDate: '2026-11-05', description: 'Ingreso próximo', status: 'planned', createdAt: '', updatedAt: '' },
      { id: 'rent', accountId: 'bank', type: 'expense', amountCents: 100_000, transactionDate: '2026-11-06', description: 'Renta prevista', status: 'planned', createdAt: '', updatedAt: '' },
    ],
    recurring: [], recurringOccurrences: [], budgets: [], goals: [], contributions: [], budgetClosures: [], savingsFundEntries: [], goalItems: [],
    liquidityPreference: { minimumOperatingBufferCents: 200_000 }, liquiditySnapshots: [],
  }
}

describe('Finance decision tools', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('changes the stress result with explicit assumptions without modifying the finance book', () => {
    const data = fixture()
    const original = structuredClone(data)
    render(<FinanceDecisionTools panel="scenarios" data={data} userId="user-a" reference={reference} />)
    const stress = screen.getByRole('heading', { name: 'Estrés', level: 3 }).closest('article')!
    const before = stress.textContent
    fireEvent.change(screen.getByLabelText(/^Imprevisto en estrés/), { target: { value: '20000' } })
    expect(stress.textContent).not.toBe(before)
    expect(stress).toHaveTextContent('-$11,100.00')
    fireEvent.change(screen.getByLabelText(/^Retraso de ingresos/), { target: { value: '14' } })
    expect(screen.getByLabelText(/^Retraso de ingresos/)).toHaveValue(14)
    expect(data).toEqual(original)
    expect(screen.getByRole('img', { name: 'Comparación de saldos diarios para los tres escenarios' })).toBeInTheDocument()
  })

  it('recommends a later purchase date and lets the user evaluate it without creating a transaction', () => {
    const data = fixture()
    const original = structuredClone(data)
    render(<FinanceDecisionTools panel="affordability" data={data} userId="user-a" reference={reference} />)
    fireEvent.change(screen.getByLabelText('Importe de la compra (MXN)'), { target: { value: '9000' } })
    expect(screen.getByText('Cruza el colchón')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Probar esa fecha' }))
    expect(screen.getByLabelText('Fecha de compra')).toHaveValue('2026-11-12')
    expect(screen.getByText('Cabe desde esa fecha')).toBeInTheDocument()
    expect(data).toEqual(original)
  })

  it('persists, edits and deletes a weekly provision for only the signed-in user', () => {
    const data = fixture()
    const original = structuredClone(data)
    const { rerender } = render(<FinanceDecisionTools panel="provisions" data={data} userId="user-a" reference={reference} />)
    fireEvent.change(screen.getByLabelText('Nombre del gasto'), { target: { value: 'Seguro de moto' } })
    fireEvent.change(screen.getByLabelText('Costo previsto (MXN)'), { target: { value: '1200' } })
    fireEvent.change(screen.getByLabelText('Ya reunido (MXN)'), { target: { value: '200' } })
    fireEvent.change(screen.getByLabelText('Fecha del gasto'), { target: { value: '2026-11-27' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar apartado' }))
    expect(screen.getByText('Seguro de moto')).toBeInTheDocument()
    expect(screen.getAllByText('$250.00')[0]).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(storageKey('user-a'))!)).toEqual([expect.objectContaining({ name: 'Seguro de moto', targetCents: 120_000, alreadySavedCents: 20_000, dueDate: '2026-11-27' })])
    rerender(<FinanceDecisionTools panel="provisions" data={data} userId="user-b" reference={reference} />)
    expect(screen.queryByText('Seguro de moto')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(storageKey('user-b'))).toBeNull()
    rerender(<FinanceDecisionTools panel="provisions" data={data} userId="user-a" reference={reference} />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar Seguro de moto' }))
    fireEvent.change(screen.getByLabelText('Ya reunido (MXN)'), { target: { value: '400' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(screen.getAllByText('$200.00')[0]).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Seguro de moto' }))
    expect(screen.getByText('Seguro de moto')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Eliminar apartado' })).getByRole('button', { name: 'Eliminar apartado' }))
    expect(screen.queryByText('Seguro de moto')).not.toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(storageKey('user-a'))!)).toEqual([])
    expect(data).toEqual(original)
  })

  it('keeps old provision plans readable after their target date instead of treating them as debt', () => {
    window.localStorage.setItem(storageKey('user-a'), JSON.stringify([{ id: 'old', name: 'Mantenimiento pasado', targetCents: 50_000, alreadySavedCents: 0, dueDate: '2026-10-25' }]))
    render(<FinanceDecisionTools panel="provisions" data={fixture()} userId="user-a" reference={reference} />)
    expect(screen.getByText('Mantenimiento pasado')).toBeInTheDocument()
    expect(screen.getByText('Revisar fecha')).toBeInTheDocument()
    expect(screen.getByText(/no implica un adeudo vencido/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Editar Mantenimiento pasado' }))
    expect(screen.getByLabelText('Fecha del gasto')).toHaveValue('2026-10-25')
  })

  it('returns mobile provision editing to the populated form and respects reduced motion without saving', () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(max-width: 760px)' || query === '(prefers-reduced-motion: reduce)', media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })))
    const saved = JSON.stringify([{ id: 'insurance', name: 'Seguro de moto', targetCents: 120_000, alreadySavedCents: 20_000, dueDate: '2026-11-27' }])
    window.localStorage.setItem(storageKey('user-a'), saved)
    const data = fixture()
    const original = structuredClone(data)
    render(<FinanceDecisionTools panel="provisions" data={data} userId="user-a" reference={reference} />)
    const form = screen.getByLabelText('Nombre del gasto').closest('form')!
    const scroll = vi.fn()
    Object.defineProperty(form, 'scrollIntoView', { configurable: true, value: scroll })
    fireEvent.click(screen.getByRole('button', { name: 'Editar Seguro de moto' }))
    expect(screen.getByLabelText('Nombre del gasto')).toHaveFocus()
    expect(screen.getByLabelText('Nombre del gasto')).toHaveValue('Seguro de moto')
    expect(screen.getByLabelText('Costo previsto (MXN)')).toHaveValue(1200)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
    expect(window.localStorage.getItem(storageKey('user-a'))).toBe(saved)
    expect(data).toEqual(original)
  })

  it('shows measured recurrence differences and the source of upcoming impacts', () => {
    const data = fixture()
    data.recurring.push({ id: 'subscription', accountId: 'bank', type: 'expense', amountCents: 10_000, description: 'Suscripción', frequency: 'monthly', startDate: '2026-10-01', nextOccurrence: '2026-11-01', isActive: true, createdAt: '', updatedAt: '' })
    data.recurringOccurrences.push({ id: 'paid', recurringTransactionId: 'subscription', period: '2026-10', expectedDate: '2026-10-20', amountCents: 10_000, status: 'paid', transactionId: 'actual-subscription', createdAt: '', updatedAt: '' })
    data.transactions.push({ id: 'actual-subscription', accountId: 'bank', type: 'expense', amountCents: 12_000, transactionDate: '2026-10-22', description: 'Suscripción realizada', status: 'completed', recurringTransactionId: 'subscription', createdAt: '', updatedAt: '' })
    render(<FinanceDecisionTools panel="audit" data={data} userId="user-a" reference={reference} />)
    const table = screen.getByRole('table', { name: 'Pagos recurrentes: previsto y realizado' })
    expect(table).toHaveTextContent('$100.00')
    expect(table).toHaveTextContent('$120.00')
    expect(table).toHaveTextContent('$20.00')
    expect(table).toHaveTextContent('2 días después')
    fireEvent.click(screen.getByText('De dónde salen los próximos impactos'))
    expect(screen.getByRole('table', { name: 'Compromisos y estimaciones de este horizonte' })).toHaveTextContent('Movimiento pendiente')
    expect(screen.getByText('Aún no hay lecturas históricas')).toBeInTheDocument()
  })

  it('explains missing debt and buffer evidence without inventing estimates', () => {
    const data = fixture()
    const { rerender } = render(<FinanceDecisionTools panel="debtcompare" data={data} userId="user-a" reference={reference} />)
    expect(screen.getByText('No hay deudas activas para comparar')).toBeInTheDocument()
    expect(screen.getByText(/No hay tasas, comisiones/)).toBeInTheDocument()
    rerender(<FinanceDecisionTools panel="buffer" data={data} userId="user-a" reference={reference} />)
    expect(screen.getByText('Falta historial para una referencia')).toBeInTheDocument()
    expect(screen.queryByText('Referencia según historial')).not.toBeInTheDocument()
    expect(data.liquidityPreference.minimumOperatingBufferCents).toBe(200_000)
  })

  it('selects an immutable weekly reading and explains added, removed and rescheduled commitments', () => {
    const previousData = fixture()
    const previousDate = new Date(2026, 9, 24, 12)
    captureFinanceForecastJournal('user-a', buildFinanceDecisionReport(previousData, { reference: previousDate }), previousDate)
    const currentData = fixture()
    currentData.transactions[0].status = 'cancelled'
    currentData.transactions[1].transactionDate = '2026-11-08'
    currentData.transactions[1].amountCents = 140_000
    currentData.transactions.push({ id: 'new', accountId: 'bank', type: 'expense', amountCents: 30_000, transactionDate: '2026-11-09', description: 'Compra nueva', status: 'planned', createdAt: '', updatedAt: '' })
    const journal = captureFinanceForecastJournal('user-a', buildFinanceDecisionReport(currentData, { reference }), reference)
    const savedJournal = structuredClone(journal)
    render(<FinanceDecisionTools panel="audit" data={currentData} userId="user-a" reference={reference} journal={journal} />)
    expect(screen.getByText('No hay impactos nuevos, retirados o modificados en las fechas comparables.')).toBeInTheDocument()
    const previousButton = screen.getByRole('button', { name: /24 oct 2026/ })
    fireEvent.click(previousButton)
    expect(previousButton).toHaveAttribute('aria-pressed', 'true')
    const changes = screen.getByRole('table', { name: 'Diferencias frente a la lectura semanal' })
    const rent = within(changes).getByText('Renta prevista').closest('tr')!
    expect(rent).toHaveTextContent('Fecha e importe')
    expect(rent).toHaveTextContent('-$1,000.00')
    expect(rent).toHaveTextContent('-$1,400.00')
    expect(rent).toHaveTextContent('6 nov 2026')
    expect(rent).toHaveTextContent('8 nov 2026')
    expect(within(changes).getByText('Compra nueva').closest('tr')).toHaveTextContent('Agregado')
    expect(within(changes).getByText('Ingreso próximo').closest('tr')).toHaveTextContent('Retirado de la previsión')
    expect(screen.queryByText('Registrado como realizado')).not.toBeInTheDocument()
    expect(journal).toEqual(savedJournal)
  })

  it('makes weekly journal read failures visible without inventing previous forecasts', () => {
    render(<FinanceDecisionTools panel="audit" data={fixture()} userId="user-a" reference={reference} journal={{ entries: [], message: 'No se pudo leer el historial semanal; sus datos guardados se conservaron.' }} />)
    expect(screen.getByRole('status')).toHaveTextContent('sus datos guardados se conservaron')
    expect(screen.getByText('Aún no hay lecturas semanales')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Diferencias frente a la lectura semanal' })).not.toBeInTheDocument()
  })
})
