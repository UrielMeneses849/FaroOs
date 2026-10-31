import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FinanceData } from '../features/finance/financeTypes'
import { FINANCE_LIQUIDITY_PROJECTION_VERSION, financeLiquidityProjection } from '../services/financeLiquidityProjection'
import { accountBalance } from '../services/financeService'
import { financeSimulationStorageKey, type FinanceSimulationState } from '../services/financeSimulation'
import { FinancePage } from './FinancePage'

const mocks = vi.hoisted(() => ({
  data: undefined as FinanceData | undefined,
  user: { id: 'owner' },
  refresh: vi.fn().mockResolvedValue(undefined),
  save: vi.fn().mockResolvedValue(undefined),
  snapshot: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../components/layout', () => ({ PageHeader: ({ title, trailing }: { title: string; trailing?: ReactNode }) => <header><h1>{title}</h1>{trailing}</header> }))
vi.mock('../lib/supabase/client', () => ({ supabase: { auth: {}, functions: {} } }))
vi.mock('../hooks/useFinance', () => ({ useFinance: () => ({ data: mocks.data, user: mocks.user, loading: false, error: null, refresh: mocks.refresh }) }))
vi.mock('../repositories/financeRepositories', () => ({
  financeAccountRepository: { save: mocks.save, archive: mocks.save, restore: mocks.save },
  financeBudgetRepository: { save: mocks.save, remove: mocks.remove },
  financeCategoryRepository: { save: mocks.save, remove: mocks.remove },
  financeGoalRepository: { save: mocks.save },
  financeLiquidityRepository: { captureInitialSnapshot: mocks.snapshot },
  financePlanningRepository: { closeBudget: mocks.save },
  financeRecurringOccurrenceRepository: { ensure: mocks.save, saveOccurrence: mocks.save },
  financeRecurringRepository: { save: mocks.save },
  financeTransactionRepository: { save: mocks.save, remove: mocks.remove },
}))
vi.mock('../repositories/financeDebtRepository', () => ({ financeDebtRepository: { save: mocks.save, pay: mocks.save, allocate: mocks.save, savePreferences: mocks.save } }))
vi.mock('../features/finance/FinanceLiquidityRadar', () => ({ FinanceLiquidityRadar: ({ data, month, availableTodayCents, onOpenDetails }: { data: FinanceData; month: Date; availableTodayCents: number; onOpenDetails?: () => void }) => {
  const projection = financeLiquidityProjection({ data, month, currentAvailableBalanceCents: availableTodayCents, minimumOperatingBufferCents: 0 })
  return <div><output aria-label="Cierre proyectado de prueba">{projection.closingBalanceCents}</output><output aria-label="Saldo real de prueba">{accountBalance(data.accounts[0], data.transactions)}</output>{onOpenDetails && <button onClick={onOpenDetails}>Ver detalle de Proyecciones</button>}</div>
} }))
vi.mock('../features/finance/ExpenseCategoryDonut', () => ({ ExpenseCategoryDonut: () => null }))
vi.mock('recharts', () => ({ Area: () => null, AreaChart: () => null, Bar: () => null, BarChart: () => null, CartesianGrid: () => null, Cell: () => null, LabelList: () => null, ReferenceLine: () => null, ResponsiveContainer: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null }))

const fixture = (): FinanceData => ({
  accounts: [{ id: 'bank', name: 'Cuenta principal', type: 'checking', currency: 'MXN', initialBalanceCents: 6_000_000, isActive: true, createdAt: '', updatedAt: '' }],
  categories: [{ id: 'salary', name: 'Sueldo', type: 'income', isDefault: false, isActive: true }],
  transactions: [], recurring: [], recurringOccurrences: [], budgets: [], goals: [], contributions: [], budgetClosures: [], savingsFundEntries: [], goalItems: [],
  liquidityPreference: { minimumOperatingBufferCents: 1_500_000 },
  liquiditySnapshots: [{ id: 'real-snapshot', month: '2026-11-01', projectionVersion: FINANCE_LIQUIDITY_PROJECTION_VERSION, initialProjectedMinimumCents: 6_000_000, initialProjectedClosingBalanceCents: 6_000_000, snapshotDate: '2026-11-10' }],
  debtPlan: { debts: [], entries: [], preferences: { monthlyContributionCents: 0, contributionDay: 15, strategy: 'minimum', targetDate: '2027-12-31' } },
})
const saved = (enabled = false): FinanceSimulationState => ({ version: 1, enabled, items: [{ id: 'watch', kind: 'expense', accountId: 'bank', description: 'Reloj del escenario', date: '2026-11-20', amountCents: 500_000 }] })
const show = (entry = '/finance') => render(<MemoryRouter initialEntries={[entry]}><main className="main-content"><FinancePage /></main></MemoryRouter>)
const switchMode = () => screen.getByRole('switch', { name: 'Modo simulación' })
const primaryPanel = (name: string) => within(screen.getByRole('navigation', { name: 'Secciones financieras' })).getByRole('button', { name })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 10, 12))
  vi.clearAllMocks()
  sessionStorage.clear()
  localStorage.clear()
  mocks.data = fixture()
  mocks.user = { id: 'owner' }
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('persistent simulation across the Finance workspace', () => {
  it('applies the scenario to the projection, restores the original forecast when switched off, and leaves actual balances intact', async () => {
    sessionStorage.setItem('faro-finance-panel', 'advisor')
    localStorage.setItem(financeSimulationStorageKey('owner'), JSON.stringify(saved()))
    const before = structuredClone(mocks.data)
    show()
    expect(screen.getByLabelText('Cierre proyectado de prueba')).toHaveTextContent('6000000')
    await userEvent.click(switchMode())
    expect(screen.getByLabelText('Cierre proyectado de prueba')).toHaveTextContent('5500000')
    expect(screen.getByLabelText('Saldo real de prueba')).toHaveTextContent('6000000')
    await userEvent.click(switchMode())
    expect(screen.getByLabelText('Cierre proyectado de prueba')).toHaveTextContent('6000000')
    expect(JSON.parse(localStorage.getItem(financeSimulationStorageKey('owner'))!).items).toHaveLength(1)
    expect(mocks.data).toEqual(before)
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })

  it('creates a saved idea in the real UI, keeps it after remount and removes it only after confirmed reset', async () => {
    const first = show()
    await userEvent.click(screen.getByRole('button', { name: 'Editar simulaciones' }))
    const form = within(screen.getByRole('form', { name: 'Movimiento simulado' }))
    fireEvent.change(form.getByLabelText('Nombre del movimiento'), { target: { value: 'Compra para diciembre' } })
    fireEvent.change(form.getByLabelText('Monto simulado MXN'), { target: { value: '2500' } })
    fireEvent.change(form.getByLabelText('Fecha simulada'), { target: { value: '2026-12-15' } })
    await userEvent.click(form.getByRole('button', { name: 'Agregar movimiento simulado' }))
    expect(screen.getByText('Compra para diciembre')).toBeInTheDocument()
    await userEvent.click(switchMode())
    await userEvent.click(switchMode())
    first.unmount()
    show()
    expect(switchMode()).not.toBeChecked()
    expect(screen.getByText('Compra para diciembre')).toBeInTheDocument()
    await userEvent.click(switchMode())
    await userEvent.click(screen.getByRole('button', { name: 'Reiniciar y limpiar' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Reiniciar y limpiar simulaciones' })).getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByText('Compra para diciembre')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reiniciar y limpiar' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Reiniciar y limpiar simulaciones' })).getByRole('button', { name: 'Limpiar escenario' }))
    expect(switchMode()).not.toBeChecked()
    expect(screen.queryByText('Compra para diciembre')).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(financeSimulationStorageKey('owner'))!)).toEqual({ version: 1, enabled: false, items: [] })
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('activates a saved idea before opening its projection and restores the real curve when switched off', async () => {
    sessionStorage.setItem('faro-finance-panel', 'simulation')
    localStorage.setItem(financeSimulationStorageKey('owner'), JSON.stringify(saved()))
    show()
    expect(screen.queryByLabelText('Periodo')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Activar y ver impacto' }))
    expect(switchMode()).toBeChecked()
    expect(screen.getByLabelText('Periodo')).toHaveValue('2026-11')
    expect(screen.getByLabelText('Cierre proyectado de prueba')).toHaveTextContent('5500000')
    await userEvent.click(switchMode())
    expect(screen.getByLabelText('Cierre proyectado de prueba')).toHaveTextContent('6000000')
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('starts a persisted active scenario without capturing a real forecast snapshot or opening real quick-action dialogs', async () => {
    localStorage.setItem(financeSimulationStorageKey('owner'), JSON.stringify(saved(true)))
    mocks.data!.liquiditySnapshots = []
    show('/finance?quick=expense')
    expect(await screen.findByRole('form', { name: 'Movimiento simulado' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Nuevo movimiento' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Registrar gasto' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Periodo')).not.toBeInTheDocument()
    await userEvent.click(primaryPanel('Proyecciones'))
    fireEvent.change(screen.getByLabelText('Periodo'), { target: { value: '2026-12' } })
    expect(mocks.snapshot).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Agregar simulación' }))
    expect(screen.getByRole('form', { name: 'Movimiento simulado' })).toBeInTheDocument()
  })

  it('disables real expense and Plan mutation controls and restores them after leaving simulation', async () => {
    localStorage.setItem(financeSimulationStorageKey('owner'), JSON.stringify(saved(true)))
    mocks.data!.transactions.push({ id: 'pending-real', accountId: 'bank', type: 'expense', amountCents: 10_000, transactionDate: '2026-11-20', description: 'Pago real pendiente', status: 'planned', createdAt: '', updatedAt: '' })
    mocks.data!.debtPlan!.debts.push({ id: 'moto', name: 'Moto', creditor: 'Crédito', kind: 'purchase', status: 'active', balanceCents: 500_000, balanceDate: '2026-11-10', paymentCents: 85_000, frequency: 'weekly', nextPaymentDate: '2026-11-14', agreementStatus: 'none', priority: 0, createdAt: '', updatedAt: '' })
    show()
    await userEvent.click(primaryPanel('Gastos'))
    const realExpense = within(screen.getByText('Pago real pendiente').closest('article')!)
    expect(realExpense.getByRole('button', { name: 'Registrar pago' })).toBeDisabled()
    expect(realExpense.getByRole('button', { name: 'Editar' })).toBeDisabled()
    await userEvent.click(realExpense.getByRole('button', { name: 'Registrar pago' }))
    expect(mocks.save).not.toHaveBeenCalled()
    await userEvent.click(primaryPanel('Plan'))
    const plan = within(screen.getByRole('region', { name: 'Plan de liquidación' }))
    expect(plan.getByRole('button', { name: 'Aportar a Plan' })).toBeDisabled()
    expect(plan.getByRole('button', { name: 'Configurar Plan' })).toBeDisabled()
    expect(plan.getByRole('button', { name: 'Registrar pago' })).toBeDisabled()
    await userEvent.click(plan.getByRole('button', { name: 'Registrar pago' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.save).not.toHaveBeenCalled()
    await userEvent.click(switchMode())
    expect(screen.getByRole('button', { name: 'Aportar a Plan' })).toBeEnabled()
    await userEvent.click(primaryPanel('Gastos'))
    expect(within(screen.getByText('Pago real pendiente').closest('article')!).getByRole('button', { name: 'Registrar pago' })).toBeEnabled()
  })

  it('keeps the simulation switch usable when a goal summary is clicked in read-only mode', async () => {
    localStorage.setItem(financeSimulationStorageKey('owner'), JSON.stringify(saved(true)))
    sessionStorage.setItem('faro-finance-panel', 'goals')
    mocks.data!.goals.push({ id: 'goal', name: 'Equipo para trabajar', targetAmountCents: 200_000, priority: 'medium', status: 'active', createdAt: '', updatedAt: '' })
    show()
    await userEvent.click(screen.getByText('Equipo para trabajar'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(switchMode()).toBeEnabled()
    await userEvent.click(switchMode())
    expect(switchMode()).not.toBeChecked()
  })

  it('discards a private unsaved form draft when the authenticated user changes', () => {
    sessionStorage.setItem('faro-finance-panel', 'simulation')
    const view = show()
    fireEvent.change(screen.getByLabelText('Nombre del movimiento'), { target: { value: 'Borrador privado de la primera cuenta' } })
    mocks.user = { id: 'other-owner' }
    mocks.data = fixture()
    mocks.data.accounts[0].id = 'other-bank'
    view.rerender(<MemoryRouter initialEntries={['/finance']}><main className="main-content"><FinancePage /></main></MemoryRouter>)
    expect(screen.getByLabelText('Nombre del movimiento')).toHaveValue('')
    expect(screen.getByLabelText('Cuenta del escenario')).toHaveValue('other-bank')
    expect(localStorage.getItem(financeSimulationStorageKey('other-owner'))).toBeNull()
  })

  it('keeps summary categories and projection navigation interactive during simulation without changing realized spending', async () => {
    localStorage.setItem(financeSimulationStorageKey('owner'), JSON.stringify(saved(true)))
    const categories = ['Casa', 'Comida', 'Transporte', 'Salud', 'Suscripciones', 'Lectura']
    mocks.data!.categories.push(...categories.map((name, index) => ({ id: `category-${index}`, name, type: 'expense' as const, isDefault: false, isActive: true })))
    mocks.data!.transactions.push(...categories.map((name, index) => ({ id: `paid-${index}`, accountId: 'bank', categoryId: `category-${index}`, type: 'expense' as const, amountCents: (6 - index) * 10_000, description: name, transactionDate: '2026-11-02', status: 'completed' as const, createdAt: '', updatedAt: '' })))
    const before = structuredClone(mocks.data)
    show()
    expect(screen.getByLabelText('Cierre proyectado de prueba')).toHaveTextContent('5290000')
    expect(screen.getByLabelText('Saldo real de prueba')).toHaveTextContent('5790000')
    const distribution = within(screen.getByRole('article', { name: 'En qué se fue' }))
    expect(distribution.getByText('$2,100.00')).toBeInTheDocument()
    expect(distribution.getAllByRole('listitem')).toHaveLength(5)
    expect(distribution.getByText('Lectura')).not.toBeVisible()
    const expand = distribution.getByRole('button', { name: /Ver todas las categorías/ })
    expect(expand).toBeEnabled()
    await userEvent.click(expand)
    expect(distribution.getAllByRole('listitem')).toHaveLength(6)
    expect(distribution.getByText('Lectura')).toBeVisible()
    expect(distribution.queryByText('Reloj del escenario')).not.toBeInTheDocument()
    // The production paper shell reveals this summary chart on desktop; the
    // minimal test shell keeps the mobile wrapper hidden. Exercise its actual
    // callback while category interaction above uses visible user controls.
    fireEvent.click(screen.getByText('Ver detalle de Proyecciones'))
    expect(primaryPanel('Proyecciones')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('Cierre proyectado de prueba')).toHaveTextContent('5290000')
    await userEvent.click(switchMode())
    expect(screen.getByLabelText('Cierre proyectado de prueba')).toHaveTextContent('5790000')
    expect(mocks.data).toEqual(before)
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })
})
