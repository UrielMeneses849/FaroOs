import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FinanceData } from './financeTypes'
import { DebtPlanPanel } from './DebtPlanPanel'
import { financeDebtRepository } from '../../repositories/financeDebtRepository'

vi.mock('../../lib/supabase/client', () => ({ supabase: { auth: {}, functions: {} } }))
vi.mock('../../repositories/financeDebtRepository', () => ({ financeDebtRepository: { pay: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), reviseEntry: vi.fn().mockResolvedValue(undefined) } }))
vi.mock('recharts', () => ({
  ResponsiveContainer: () => null, Area: () => null, AreaChart: () => null, CartesianGrid: () => null,
  ReferenceLine: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null,
}))
const fixture = (): FinanceData => ({
  accounts: [{ id: 'bank', name: 'Banco', type: 'checking', currency: 'MXN', initialBalanceCents: 10000000, isActive: true, createdAt: '', updatedAt: '' }],
  categories: [{ id: 'plan', name: 'Plan', type: 'expense', icon: 'wallet', color: '#000', isDefault: false, isActive: true }],
  transactions: [], recurring: [], recurringOccurrences: [], budgets: [], goals: [], contributions: [], budgetClosures: [], savingsFundEntries: [], goalItems: [],
  liquidityPreference: { minimumOperatingBufferCents: 180000 }, liquiditySnapshots: [],
  debtPlan: { debts: [{ id: 'moto', name: 'Moto', creditor: 'Vento', kind: 'loan', status: 'active', balanceCents: 2265000, balanceDate: '2026-10-27', paymentCents: 90600,
    frequency: 'weekly', nextPaymentDate: '2026-11-07', agreementStatus: 'none', priority: 0, createdAt: '', updatedAt: '' }], entries: [],
    preferences: { monthlyContributionCents: 0, contributionDay: 15, targetDate: '2027-12-31', strategy: 'minimum' } },
})

afterEach(() => vi.useRealTimers())
function setup(source = fixture()) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 27, 12))
  render(<DebtPlanPanel data={source} userId="user" onRefresh={vi.fn().mockResolvedValue(undefined)} />)
}

describe('debt calendar interactions', () => {
  it('opens the selected future balance, simulates without saving and uses a different balance for another week', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Ver proyección Moto 6 feb 2027/ }))
    let dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('heading').textContent).toContain('6 feb 2027')
    expect(dialog.getByText('Saldo después de este pago').textContent).toContain('$9,966.00')
    expect(dialog.queryByLabelText('Fecha real de pago')).not.toBeInTheDocument()
    fireEvent.change(dialog.getByLabelText('Abono extra MXN'), { target: { value: '9966' } })
    expect(dialog.getByText('Saldo al terminar ese día').textContent).toContain('$0.00')
    expect(financeDebtRepository.pay).not.toHaveBeenCalled()
    fireEvent.click(dialog.getByRole('button', { name: 'Cerrar' }))
    fireEvent.click(screen.getByRole('button', { name: /Ver proyección Moto 13 feb 2027/ }))
    dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('Saldo después de este pago').textContent).toContain('$9,060.00')
    expect(dialog.getByLabelText('Abono extra MXN')).toHaveValue(null)
  })
  it('records creditor corrections and a refreshed payoff quote with the real payment', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar pago' }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('Saldo a plazo después de este pago MXN'), { target: { value: '22000' } })
    fireEvent.change(dialog.getByLabelText('Nuevo monto para liquidar MXN'), { target: { value: '18000' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Confirmar pago registrado' }))
    expect(financeDebtRepository.pay).toHaveBeenCalledWith(expect.objectContaining({
      amountCents: 90600, debtBalanceAdjustmentCents: 25600, debtQuoteCents: 1800000, transactionDate: '2026-10-27',
    }), undefined, 'user')
  })
})


function coppelFixture(): FinanceData {
  const source = fixture()
  const template = source.debtPlan!.debts[0]
  const purchases = [
    { id: 'ps5', name: 'Coppel · PS5 Digital', balanceCents: 777800, paymentCents: 60000, deadline: '2026-11-15' },
    { id: 'telcel', name: 'Coppel · Telcel', balanceCents: 949200, paymentCents: 105800 },
    { id: 'laptop', name: 'Coppel · Laptop', balanceCents: 2445400, paymentCents: 163500 },
  ].map((item, priority) => ({ ...template, ...item, creditor: 'Coppel', kind: 'purchase' as const, frequency: 'monthly' as const, nextPaymentDate: '2026-11-15', priority }))
  source.debtPlan!.debts = [...purchases, template]
  source.recurring = purchases.map(item => ({ id: `recurring-${item.id}`, debtId: item.id, accountId: 'bank', categoryId: 'plan', type: 'expense',
    description: item.name, amountCents: item.paymentCents, frequency: 'monthly', dayOfMonth: 15, startDate: '2026-11-15', nextOccurrence: '2026-11-15',
    endDate: item.deadline, isActive: true, createdAt: '', updatedAt: '' }))
  source.recurringOccurrences = purchases.flatMap(item => (item.deadline ? ['11'] : ['11', '12']).map(month => ({ id: `${item.id}-${month}`, recurringTransactionId: `recurring-${item.id}`,
    period: `2026-${month}-01`, expectedDate: `2026-${month}-15`, amountCents: item.deadline ? item.balanceCents : item.paymentCents, status: 'pending' as const, createdAt: '', updatedAt: '' })))
  return source
}

describe('Coppel monthly calendar and November payoff', () => {
  it('shows each monthly installment on the 15th and stops PS5 after its November payoff', () => {
    setup(coppelFixture())
    expect(screen.getByRole('button', { name: 'Mensual' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('columnheader', { name: 'noviembre 2026' })).toBeInTheDocument()
    const telcel = within(screen.getByRole('rowheader', { name: /Coppel · Telcel/ }))
    expect(telcel.getByText('Cada día 15 del mes · $1,058.00')).toBeInTheDocument()
    for (const [product, amount] of [['Telcel', '$1,058'], ['Laptop', '$1,635']]) {
      for (const month of ['noviembre', 'diciembre', 'enero', 'febrero']) {
        const cell = within(screen.getByRole('cell', { name: `Coppel · ${product} · ${month} ${['enero', 'febrero'].includes(month) ? '2027' : '2026'}` }))
        expect(cell.getByRole('button').textContent).toContain(amount)
        expect(cell.getByRole('button').textContent).toContain('15 ')
      }
    }
    const ps5November = within(screen.getByRole('cell', { name: 'Coppel · PS5 Digital · noviembre 2026' }))
    expect(ps5November.getByRole('button')).toHaveTextContent('Liquidación prevista')
    expect(ps5November.getByRole('button')).toHaveTextContent('15 nov')
    const ps5December = within(screen.getByRole('cell', { name: 'Coppel · PS5 Digital · diciembre 2026' }))
    expect(ps5December.queryByRole('button')).not.toBeInTheDocument()
    expect(ps5December.getByText(/Liquidada en el plan/)).toBeInTheDocument()
    fireEvent.click(ps5November.getByRole('button'))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('Liquidar el 15 de noviembre 2026')).toBeInTheDocument()
    expect(dialog.getByText(/El abono habitual es/)).toHaveTextContent('$600.00 cada día 15')
    expect(dialog.getByText(/no se suman ambos pagos/)).toBeInTheDocument()
  })
  it('preserves the exact monthly dates when switching to the weekly view', () => {
    setup(coppelFixture())
    fireEvent.click(screen.getByRole('button', { name: 'Semanal' }))
    expect(screen.getByRole('columnheader', { name: 'Deuda / semana' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ver proyección Coppel · Telcel 15 dic 2026/ })).toHaveTextContent('15 dic')
    expect(screen.getByRole('button', { name: /Ver proyección Coppel · PS5 Digital 15 nov 2026/ })).toHaveTextContent('Liquidación prevista')
  })
})


describe('Keyboard access to the debt timeline', () => {
  it('keeps an explicit focus target when there are no payment buttons in the calendar', () => {
    const source = fixture()
    source.debtPlan!.debts = []
    setup(source)
    const timeline = screen.getByRole('region', { name: 'Calendario de pagos' })
    expect(timeline).toHaveAttribute('tabindex', '0')
    timeline.focus()
    expect(timeline).toHaveFocus()
    expect(within(timeline).queryByRole('button')).not.toBeInTheDocument()
    expect(within(timeline).getByRole('table', { name: 'Pagos por deuda y fecha' })).toBeInTheDocument()
  })
})


describe('Contextual debt deletion', () => {
  it('requires confirmation before deleting from the debt card', async () => {
    vi.mocked(financeDebtRepository.remove).mockClear()
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Moto' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Eliminar deuda' })).getByRole('button', { name: 'Cancelar' }))
    expect(financeDebtRepository.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Moto' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Eliminar deuda' })).getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(financeDebtRepository.remove).toHaveBeenCalledWith('moto', 'user'))
  })
})


describe('Plan reservation corrections', () => {
  const source = () => {
    const data = fixture()
    data.debtPlan!.entries = [{ id: 'reserve-original', accountId: 'bank', amountCents: 30000, entryDate: '2026-10-20', notes: 'Aportación original', createdAt: '' }]
    return data
  }
  const history = () => fireEvent.click(screen.getByRole('button', { name: 'Ver aportaciones y liberar dinero' }))
  it('edits the same reserve, keeps its account and submits corrected amount and date', async () => {
    vi.mocked(financeDebtRepository.reviseEntry).mockClear()
    setup(source()); history()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Editar' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByLabelText('Cuenta de origen')).toBeDisabled()
    expect(dialog.getByLabelText('Monto MXN')).toHaveValue(300)
    expect(dialog.getByLabelText('Fecha de la reserva')).toHaveValue('2026-10-20')
    fireEvent.change(dialog.getByLabelText('Monto MXN'), { target: { value: '400' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Actualizar reserva' }))
    await waitFor(() => expect(financeDebtRepository.reviseEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'reserve-original', amountCents: 40000, date: '2026-10-20' }), 'user'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
  it('cancels without deleting and confirms deletion using the original id', async () => {
    vi.mocked(financeDebtRepository.reviseEntry).mockClear()
    setup(source()); history()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))
    expect(financeDebtRepository.reviseEntry).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    history(); fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar reserva' }))
    await waitFor(() => expect(financeDebtRepository.reviseEntry).toHaveBeenCalledWith({ id: 'reserve-original', remove: true }, 'user'))
  })
  it('keeps the editor and the original record when the server rejects a change', async () => {
    vi.mocked(financeDebtRepository.reviseEntry).mockRejectedValueOnce(new Error('Parte de esta reserva ya se utilizó.'))
    setup(source()); history()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Editar' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Actualizar reserva' }))
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('ya se utilizó'))
    expect(within(screen.getByRole('dialog')).getByLabelText('Monto MXN')).toHaveValue(300)
  })
})
