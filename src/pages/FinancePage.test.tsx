import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FinanceData } from '../features/finance/financeTypes'
import { FinancePage } from './FinancePage'

const mocks = vi.hoisted(() => ({
  data: undefined as FinanceData | undefined,
  loading: false,
  error: null as string | null,
  refresh: vi.fn().mockResolvedValue(undefined),
  save: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  user: undefined as { id: string } | undefined,
}))
vi.mock('../components/layout', () => ({ PageHeader: ({ title, trailing }: { title: string; trailing?: ReactNode }) => <header><h1>{title}</h1>{trailing}</header> }))
vi.mock('../lib/supabase/client', () => ({ supabase: { auth: {}, functions: {} } }))
vi.mock('../hooks/useFinance', () => ({ useFinance: () => ({ ...mocks, user: mocks.user }) }))
vi.mock('../repositories/financeRepositories', () => ({
  financeAccountRepository: { save: mocks.save }, financeBudgetRepository: { save: mocks.save, remove: mocks.remove },
  financeCategoryRepository: { save: mocks.save }, financeGoalRepository: { save: mocks.save },
  financeLiquidityRepository: { captureInitialSnapshot: mocks.save }, financePlanningRepository: {},
  financeRecurringOccurrenceRepository: {}, financeRecurringRepository: {}, financeTransactionRepository: { save: mocks.save, remove: mocks.remove },
}))
vi.mock('../features/finance/FinanceLiquidityRadar', () => ({ FinanceLiquidityRadar: () => <div aria-label="Gráfica de proyección" /> }))
vi.mock('../features/finance/ExpenseCategoryDonut', () => ({ ExpenseCategoryDonut: () => null }))
vi.mock('recharts', () => ({ Bar: () => null, BarChart: () => null, CartesianGrid: () => null, Cell: () => null, LabelList: () => null, ReferenceLine: () => null, ResponsiveContainer: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null }))

const fixture = (): FinanceData => ({
  accounts: [{ id: 'bank', name: 'Cuenta principal', type: 'checking', currency: 'MXN', initialBalanceCents: 6000000, isActive: true, createdAt: '', updatedAt: '' }],
  categories: [{ id: 'salary', name: 'Sueldo', type: 'income', icon: 'wallet', color: '#173d76', isDefault: false, isActive: true }],
  transactions: [], recurring: [], recurringOccurrences: [], budgets: [], goals: [], contributions: [], budgetClosures: [], savingsFundEntries: [], goalItems: [],
  liquidityPreference: { minimumOperatingBufferCents: 1500000 }, liquiditySnapshots: [],
})
type TestEntry = string | { pathname: string; search?: string; hash?: string; state?: unknown }
function RouteTools() {
  const location = useLocation(), navigate = useNavigate(), navigationType = useNavigationType()
  return <><output aria-label="Ubicación del router">{JSON.stringify({ ...location, navigationType })}</output>
    <button onClick={() => navigate({ pathname: location.pathname, search: '?quick=movement&from=mini', hash: '#new' }, { state: { source: 'mini' } })}>Acceso movimiento</button>
    <button onClick={() => navigate({ pathname: location.pathname, search: '?quick=expense&from=pwa', hash: '#expense' }, { state: { source: 'pwa' } })}>Acceso gasto</button>
  </>
}
function TestRouter({ entry = '/finance' }: { entry?: TestEntry }) { return <MemoryRouter initialEntries={[entry]}><main className="main-content"><FinancePage /></main><RouteTools /></MemoryRouter> }
const show = (entry?: TestEntry) => render(<TestRouter entry={entry} />)
const routerLocation = () => JSON.parse(screen.getByLabelText('Ubicación del router').textContent || '{}')
beforeEach(() => {
  mocks.data = fixture(); mocks.loading = false; mocks.error = null
  mocks.user = undefined; mocks.remove.mockClear(); mocks.refresh.mockClear(); mocks.save.mockClear(); sessionStorage.clear()
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})

describe('Finance entry points and data recovery', () => {
  it('opens the generic movement chooser from a dashboard link without saving a transaction', async () => {
    show('/finance?quick=movement')
    const menu = within(await screen.findByRole('dialog', { name: 'Nuevo movimiento' }))
    expect(menu.getByRole('button', { name: /^Registrar ingreso/ })).toBeInTheDocument()
    expect(menu.getByRole('button', { name: /^Registrar gasto/ })).toBeInTheDocument()
    await waitFor(() => expect(routerLocation().search).toBe(''))
    expect(mocks.save).not.toHaveBeenCalled()
    fireEvent.click(menu.getByRole('button', { name: /^Registrar ingreso/ }))
    expect(await screen.findByLabelText('Tipo')).toHaveValue('income')
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('waits for the account load before consuming a quick action', async () => {
    mocks.loading = true
    const view = show('/finance?quick=movement')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(routerLocation().search).toBe('?quick=movement')
    mocks.loading = false
    view.rerender(<TestRouter entry='/finance?quick=movement' />)
    expect(await screen.findByRole('dialog', { name: 'Nuevo movimiento' })).toBeInTheDocument()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('reopens movement and expense shortcuts while the same Finance page stays mounted', async () => {
    const user = userEvent.setup()
    show()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await user.click(screen.getByRole('button', { name: 'Acceso movimiento' }))
      const menu = await screen.findByRole('dialog', { name: 'Nuevo movimiento' })
      await waitFor(() => expect(routerLocation()).toMatchObject({ pathname: '/finance', search: '?from=mini', hash: '#new', state: { source: 'mini' }, navigationType: 'REPLACE' }))
      await user.click(within(menu).getByRole('button', { name: 'Cerrar modal' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }
    await user.click(screen.getByRole('button', { name: 'Acceso gasto' }))
    expect(await screen.findByLabelText('Tipo')).toHaveValue('expense')
    await waitFor(() => expect(routerLocation()).toMatchObject({ pathname: '/finance', search: '?from=pwa', hash: '#expense', state: { source: 'pwa' }, navigationType: 'REPLACE' }))
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('uses the newest quick request received while financial data is loading', async () => {
    mocks.loading = true
    const view = show('/finance?quick=movement')
    fireEvent.click(screen.getByRole('button', { name: 'Acceso gasto' }))
    expect(routerLocation().search).toBe('?quick=expense&from=pwa')
    mocks.loading = false
    view.rerender(<TestRouter entry='/finance?quick=movement' />)
    expect(await screen.findByLabelText('Tipo')).toHaveValue('expense')
    expect(screen.queryByRole('button', { name: /^Registrar ingreso/ })).not.toBeInTheDocument()
    await waitFor(() => expect(routerLocation().search).toBe('?from=pwa'))
  })
  it('consumes only quick and preserves unrelated query values, the hash and router state', async () => {
    show({ pathname: '/finance', search: '?view=all&quick=movement&tag=one&tag=two', hash: '#ledger', state: { source: 'mini', selected: 4 } })
    await screen.findByRole('dialog', { name: 'Nuevo movimiento' })
    await waitFor(() => expect(routerLocation()).toMatchObject({ pathname: '/finance', search: '?view=all&tag=one&tag=two', hash: '#ledger', state: { source: 'mini', selected: 4 }, navigationType: 'REPLACE' }))
  })
  it('reports the missing account and consumes the shortcut without saving', async () => {
    mocks.data!.accounts = []
    show('/finance?quick=movement&from=mini')
    expect(await screen.findByText('Crea una cuenta antes de registrar tu primer movimiento.')).toBeInTheDocument()
    await waitFor(() => expect(routerLocation().search).toBe('?from=mini'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('leaves unrelated quick values untouched when Finance is embedded in the Lab', () => {
    show({ pathname: '/lab', search: '?quick=task&experiment=1', hash: '#finance', state: { lab: true } })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(routerLocation()).toMatchObject({ pathname: '/lab', search: '?quick=task&experiment=1', hash: '#finance', state: { lab: true }, navigationType: 'POP' })
  })
  it('keeps the Lab pathname when a valid Finance shortcut is requested there', async () => {
    show({ pathname: '/lab', search: '?quick=movement&experiment=1', hash: '#finance', state: { lab: true } })
    await screen.findByRole('dialog', { name: 'Nuevo movimiento' })
    await waitFor(() => expect(routerLocation()).toMatchObject({ pathname: '/lab', search: '?experiment=1', hash: '#finance', state: { lab: true }, navigationType: 'REPLACE' }))
  })
  it('keeps the last loaded balance and exposes retry when a refresh fails', () => {
    mocks.error = 'No hay conexión.'
    show()
    const notice = within(screen.getByRole('alert'))
    expect(notice.getByText(/Estás viendo los últimos datos cargados/)).toBeInTheDocument()
    expect(screen.getAllByText('$60,000.00').length).toBeGreaterThan(0)
    fireEvent.click(notice.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })
})


describe('Keyboard access to wide financial ledgers', () => {
  it('lets the monthly comparison and movements receive keyboard focus without changing data', () => {
    show()
    const comparison = screen.getByRole('region', { name: 'Comparativo mensual: planeado contra real' })
    expect(comparison).toHaveAttribute('tabindex', '0')
    comparison.focus()
    expect(comparison).toHaveFocus()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Secciones financieras' })).getByRole('button', { name: 'Movimientos' }))
    const movements = screen.getByRole('region', { name: 'Movimientos financieros' })
    expect(movements).toHaveAttribute('tabindex', '0')
    movements.focus()
    expect(movements).toHaveFocus()
    expect(mocks.save).not.toHaveBeenCalled()
  })
})


describe('Finance workspace scroll ownership', () => {
  it('starts each panel and period at the top while preserving the mounted scroll region', () => {
    const view = show()
    const content = screen.getByRole('region', { name: 'Contenido de Finanzas' })
    const main = screen.getByRole('main')
    const layout = content.closest<HTMLElement>('.finance-layout')!
    const rail = screen.getByRole('complementary', { name: 'Resumen financiero' })
    expect(content).toHaveAttribute('tabindex', '0')
    expect(rail).toHaveAttribute('tabindex', '0')
    content.focus()
    expect(content).toHaveFocus()
    content.scrollTop = 640
    content.scrollLeft = 80
    main.scrollTop = 720
    layout.scrollTop = 550
    main.scrollLeft = 60
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Secciones financieras' })).getByRole('button', { name: 'Ingresos' }))
    expect(screen.getByRole('region', { name: 'Contenido de Finanzas' })).toBe(content)
    expect(content.scrollTop).toBe(0)
    expect(content.scrollLeft).toBe(0)
    expect(main.scrollTop).toBe(0)
    expect(main.scrollLeft).toBe(0)
    expect(layout.scrollTop).toBe(0)
    content.scrollTop = 480
    main.scrollTop = 540
    layout.scrollTop = 350
    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }))
    expect(content.scrollTop).toBe(0)
    expect(main.scrollTop).toBe(0)
    expect(layout.scrollTop).toBe(0)
    content.scrollTop = 300
    main.scrollTop = 180
    view.rerender(<TestRouter />)
    expect(content.scrollTop).toBe(300)
    expect(main.scrollTop).toBe(180)
    rail.focus()
    expect(rail).toHaveFocus()
    expect(mocks.save).not.toHaveBeenCalled()
  })
})


describe('Financial records have contextual edit and delete controls', () => {
  it('can delete an eventual income only after confirming, including an already collected income', async () => {
    mocks.user = { id: 'owner' }
    sessionStorage.setItem('faro-finance-panel', 'income')
    mocks.data!.transactions = [{ id: 'income', accountId: 'bank', categoryId: 'salary', type: 'income', amountCents: 12000, transactionDate: new Date().toISOString().slice(0, 10), description: 'Cobro de prueba', status: 'completed', createdAt: '', updatedAt: '' }]
    show()
    const income = screen.getByText('Cobro de prueba').closest('article')!
    fireEvent.click(within(income).getByRole('button', { name: 'Eliminar' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Eliminar movimiento' })).getByRole('button', { name: 'Cancelar' }))
    expect(mocks.remove).not.toHaveBeenCalled()
    fireEvent.click(within(income).getByRole('button', { name: 'Eliminar' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Eliminar movimiento' })).getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('income', 'owner'))
    expect(mocks.refresh).toHaveBeenCalled()
  })
  it('opens the original income in the shared movement editor', () => {
    sessionStorage.setItem('faro-finance-panel', 'income')
    mocks.data!.transactions = [{ id: 'income', accountId: 'bank', categoryId: 'salary', type: 'income', amountCents: 12000, transactionDate: new Date().toISOString().slice(0, 10), description: 'Cobro editable', status: 'completed', createdAt: '', updatedAt: '' }]
    show()
    fireEvent.click(within(screen.getByText('Cobro editable').closest('article')!).getByRole('button', { name: 'Editar' }))
    const editor = within(screen.getByRole('dialog', { name: 'Editar movimiento' }))
    expect(editor.getByLabelText('Descripción')).toHaveValue('Cobro editable')
    expect(editor.getByLabelText('Monto MXN')).toHaveValue(120)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('removes the duplicate total-today metric from the workspace', () => {
    show()
    expect(screen.queryByText('Saldo total hoy')).not.toBeInTheDocument()
    expect(screen.getAllByText('Disponible operativo hoy').length).toBeGreaterThan(0)
  })
})


describe('Finance record identity on updates and contextual budget deletion', () => {
  it('updates the existing income id without creating a duplicate', async () => {
    const id = '11111111-1111-4111-8111-111111111111', accountId = '22222222-2222-4222-8222-222222222222', categoryId = '33333333-3333-4333-8333-333333333333'
    mocks.user = { id: 'owner' }
    mocks.data!.accounts[0].id = accountId
    mocks.data!.categories[0].id = categoryId
    mocks.data!.transactions = [{ id, accountId, categoryId, type: 'income', amountCents: 12000, transactionDate: new Date().toISOString().slice(0, 10), description: 'Ingreso que se actualiza', status: 'completed', createdAt: '', updatedAt: '' }]
    sessionStorage.setItem('faro-finance-panel', 'income')
    show()
    fireEvent.click(within(screen.getByText('Ingreso que se actualiza').closest('article')!).getByRole('button', { name: 'Editar' }))
    const editor = within(screen.getByRole('dialog', { name: 'Editar movimiento' }))
    fireEvent.change(editor.getByLabelText('Monto MXN'), { target: { value: '1250' } })
    fireEvent.click(editor.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ id, accountId, amountCents: 125000 }), 'owner'))
  })
  it('exposes budget deletion from the card and preserves it when cancelled', async () => {
    mocks.user = { id: 'owner' }
    const now = new Date(), month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    mocks.data!.categories.push({ id: 'living', name: 'Casa', type: 'expense', isDefault: false, isActive: true })
    mocks.data!.budgets = [{ id: 'budget', categoryId: 'living', month: `${month}-01`, name: 'Casa', plannedAmountCents: 500000, periodStart: `${month}-16`, periodEnd: `${month}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`, createdAt: '', updatedAt: '' }]
    sessionStorage.setItem('faro-finance-panel', 'budgets')
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar presupuesto Casa' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Eliminar presupuesto' })).getByRole('button', { name: 'Cancelar' }))
    expect(mocks.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar presupuesto Casa' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Eliminar presupuesto' })).getByRole('button', { name: 'Eliminar presupuesto' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('budget', 'owner'))
  })
})


it('keeps all seven priorities in the same order on phones and groups only secondary sections', async () => {
  show()
  const nav = within(screen.getByLabelText('Navegación de finanzas'))
  expect(nav.getAllByRole('button', { hidden: true }).map(button => button.textContent)).toEqual(['Resumen', 'Proyecciones', 'Ingresos', 'Gastos', 'Plan', 'Movimientos', 'Presupuestos', 'Más'])
  fireEvent.click(nav.getByLabelText('Más secciones de Finanzas'))
  const tools = within(screen.getByRole('navigation', { name: 'Herramientas de Finanzas' }))
  expect(tools.getAllByRole('button').map(button => button.querySelector('strong')?.textContent)).toEqual(['Cuentas', 'Ahorro', 'Metas', 'Fondo', 'Simulaciones', 'Precisión de proyecciones', 'Escenarios y estrés', 'Antes de decidir', 'Comparar deudas', 'Gastos futuros', 'Colchón sugerido'])
})


describe('Plan payments in recurring expenses', () => {
  it('shows the motorcycle installments, opens the shared Plan payment dialog, and keeps paid installments visible', async () => {
    const now = new Date()
    const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    mocks.data!.debtPlan = { entries: [], preferences: { monthlyContributionCents: 0, contributionDay: 15, strategy: 'minimum', targetDate: first }, debts: [{
      id: 'moto', name: 'Moto', creditor: 'Crédito', kind: 'purchase', status: 'active', balanceCents: 500000, balanceDate: first,
      paymentCents: 85000, frequency: 'weekly', nextPaymentDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`, agreementStatus: 'none', priority: 0, createdAt: '', updatedAt: '',
    }] }
    mocks.data!.categories.push({ id: 'plan', name: 'Plan', type: 'expense', isActive: true, isDefault: true })
    mocks.data!.transactions.push({ id: 'paid-moto', debtId: 'moto', accountId: 'bank', type: 'expense', categoryId: 'plan', amountCents: 85000, transactionDate: first, description: 'Pago · Moto', status: 'completed', createdAt: '', updatedAt: '' })
    sessionStorage.setItem('faro-finance-panel', 'recurring')
    show()
    const recurring = within(screen.getByRole('region', { name: 'Gastos recurrentes' }))
    expect(recurring.getAllByText('Moto').length).toBeGreaterThan(1)
    expect(recurring.getByText('Pagado')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Gastos eventuales' })).queryByText('Pago · Moto')).not.toBeInTheDocument()
    fireEvent.click(recurring.getAllByRole('button', { name: 'Registrar pago' })[0])
    expect(await screen.findByRole('dialog', { name: 'Registrar pago · Moto' })).toBeInTheDocument()
    expect(screen.getByLabelText('Pago real MXN')).toHaveValue(850)
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
