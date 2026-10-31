import { describe, expect, it } from 'vitest'
import type { FinanceData, FinanceTransaction } from '../features/finance/financeTypes'
import { defaultDebtPlanPreferences } from '../features/finance/debtTypes'
import { scheduledDebtPayments as buildDebtSchedule } from './debtSchedule'
import { financeLiquidityProjection } from './financeLiquidityProjection'
import { financeProjectionBreakdown } from './financeService'
import { projectDebtPlan } from './debtPlanService'

const data = (): FinanceData => ({
  accounts: [{ id: 'bank', name: 'Banco', type: 'checking', currency: 'MXN', initialBalanceCents: 1_000_000, isActive: true, createdAt: '', updatedAt: '' }],
  categories: [], transactions: [], recurring: [], recurringOccurrences: [], budgets: [], goals: [], contributions: [], budgetClosures: [], savingsFundEntries: [], goalItems: [],
  liquidityPreference: { minimumOperatingBufferCents: 0 }, liquiditySnapshots: [],
  debtPlan: { entries: [], preferences: defaultDebtPlanPreferences(), debts: [{ id: 'moto', name: 'Moto', creditor: 'Crédito', kind: 'purchase', status: 'active', balanceCents: 500_000, balanceDate: '2026-10-29', paymentCents: 85_000, frequency: 'weekly', nextPaymentDate: '2026-10-31', agreementStatus: 'none', priority: 0, createdAt: '', updatedAt: '' }] },
})
const movement = (overrides: Partial<FinanceTransaction> = {}): FinanceTransaction => ({ id: 'paid', accountId: 'bank', type: 'expense', debtId: 'moto', amountCents: 85_000, transactionDate: '2026-10-31', description: 'Pago · Moto', status: 'completed', createdAt: '', updatedAt: '', ...overrides })
const reference = new Date(2026, 9, 29)
const scheduledDebtPayments = (source: FinanceData, through: string) => buildDebtSchedule(source, through, reference)
const projection = (source: FinanceData, month = new Date(2026, 10, 1), available = 1_000_000) => financeLiquidityProjection({ data: source, month, referenceDate: reference, currentAvailableBalanceCents: available, minimumOperatingBufferCents: 0 })

describe('shared Plan installment calendar', () => {
  it('puts the motorcycle on every Saturday in the next month and carries October payment into its opening cash', () => {
    const source = data()
    const november = projection(source)
    expect(november.events.filter(item => item.source === 'debt').map(item => item.date)).toEqual(['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28'])
    expect(november.openingBalanceCents).toBe(915_000)
    expect(november.closingBalanceCents).toBe(575_000)
    expect(financeProjectionBreakdown(source, new Date(2026, 10, 1), reference).gastosPendientes).toBe(340_000)
  })
  it('uses a registered Plan payment exactly once and restores the estimate after undo', () => {
    const source = data()
    source.transactions = [movement()]
    expect(scheduledDebtPayments(source, '2026-10-31')).toEqual([])
    expect(projection(source, new Date(2026, 9, 1), 915_000).closingBalanceCents).toBe(915_000)
    expect(projection(source, new Date(2026, 10, 1), 915_000).closingBalanceCents).toBe(575_000)
    source.transactions[0].status = 'cancelled'
    expect(scheduledDebtPayments(source, '2026-10-31')).toHaveLength(1)
  })
  it('lets a planned payment own its date and caps the last estimate across months', () => {
    const source = data()
    source.transactions = [movement({ status: 'planned' })]
    const schedule = scheduledDebtPayments(source, '2027-01-31')
    expect(schedule.map(item => item.date)).not.toContain('2026-10-31')
    expect(schedule.at(-1)).toMatchObject({ date: '2026-12-05', amountCents: 75_000 })
    expect(schedule.reduce((sum, item) => sum + item.amountCents, 85_000)).toBe(500_000)
    expect(projection(source).closingBalanceCents).toBe(575_000)
  })
  it('does not add fallback estimates for linked recurring debts, paused debts or settled debts', () => {
    const source = data()
    const debt = source.debtPlan!.debts[0]
    source.recurring = [{ id: 'linked', debtId: 'moto', type: 'expense', amountCents: 85_000, frequency: 'weekly', nextOccurrence: '2026-10-31', startDate: '2026-10-31', accountId: 'bank', description: 'Moto', isActive: true, createdAt: '', updatedAt: '' }]
    expect(scheduledDebtPayments(source, '2026-12-31')).toEqual([])
    source.recurring = []; debt.status = 'paused'
    expect(scheduledDebtPayments(source, '2026-12-31')).toEqual([])
    debt.status = 'active'; source.transactions = [movement({ debtSettlement: true })]
    expect(scheduledDebtPayments(source, '2026-12-31')).toEqual([])
  })
  it('reserves only the Plan budget left after dated installments', () => {
    const source = data()
    source.categories = [{ id: 'plan', name: 'Plan', type: 'expense', isActive: true, isDefault: true }]
    source.budgets = [{ id: 'budget', categoryId: 'plan', month: '2026-11-01', periodStart: '2026-11-01', periodEnd: '2026-11-30', plannedAmountCents: 400_000, createdAt: '', updatedAt: '' }]
    const november = financeLiquidityProjection({ data: source, month: new Date(2026, 10, 1), referenceDate: reference, currentAvailableBalanceCents: 1_000_000, minimumOperatingBufferCents: 0, includedBudgetCategoryIds: ['plan'] })
    expect(november.events.find(item => item.source === 'budget')?.amountCents).toBe(-60_000)
    expect(november.closingBalanceCents).toBe(515_000)
    expect(financeProjectionBreakdown(source, new Date(2026, 10, 1), reference).gastosPendientes).toBe(400_000)
  })
  it('continues Saturdays after a linked legacy recurrence has ended', () => {
    const source = data()
    source.recurring = [{ id: 'legacy', debtId: 'moto', type: 'expense', amountCents: 85_000, frequency: 'weekly', nextOccurrence: '2026-10-24', startDate: '2026-01-01', endDate: '2026-10-24', accountId: 'bank', description: 'Pago Moto', isActive: true, createdAt: '', updatedAt: '' }]
    expect(projection(source).events.filter(item => item.source === 'debt').map(item => item.date)).toEqual(['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28'])
    expect(projectDebtPlan(source, { reference, strategy: 'minimum', months: 3 }).totalPaidCents).toBe(500_000)
  })
  it('does not manufacture arrears from a stale Saturday anchor or consume the balance for them', () => {
    const source = data()
    const debt = source.debtPlan!.debts[0]
    debt.balanceDate = '2026-10-16'; debt.nextPaymentDate = '2026-10-17'
    source.transactions = [movement({ transactionDate: '2026-10-17' })]
    expect(scheduledDebtPayments(source, '2026-10-31').map(item => item.date)).toEqual(['2026-10-31'])
    const october = projection(source, new Date(2026, 9, 1))
    expect(october.events.filter(item => item.source === 'debt')).toEqual([
      expect.objectContaining({ date: '2026-10-31', amountCents: -85_000 }),
    ])
    expect(october.events.some(item => item.isOverdue)).toBe(false)
    expect(october.days.find(item => item.date === '2026-10-29')?.balanceCents).toBe(1_000_000)
    expect(financeProjectionBreakdown(source, new Date(2026, 9, 1), reference).gastosPendientes).toBe(85_000)
    const plan = projectDebtPlan(source, { reference, strategy: 'minimum', months: 3 })
    expect(plan.events[0].date).toBe('2026-10-31')
    expect(plan.totalPaidCents).toBe(415_000)
  })
  it('preserves explicit overdue commitments and forecasts nothing for past months', () => {
    const source = data()
    source.debtPlan!.debts[0].balanceDate = '2026-09-01'
    source.debtPlan!.debts[0].nextPaymentDate = '2026-09-05'
    source.transactions = [movement({ status: 'pending', transactionDate: '2026-10-24' })]
    expect(scheduledDebtPayments(source, '2026-09-30')).toEqual([])
    expect(projection(source, new Date(2026, 9, 1)).events.find(item => item.id === 'movement:paid'))
      .toMatchObject({ date: '2026-10-29', originalDate: '2026-10-24', isOverdue: true })
    expect(scheduledDebtPayments(source, '2027-01-31').reduce((sum, item) => sum + item.amountCents, 85_000)).toBe(500_000)
  })
  it('keeps the Plan cash forecast from charging its own shared estimates twice', () => {
    const source = data()
    const plan = projectDebtPlan(source, { reference, strategy: 'minimum', months: 3 })
    expect(plan.totalPaidCents).toBe(500_000)
    expect(plan.days.at(-1)?.balanceCents).toBe(500_000)
  })
})
