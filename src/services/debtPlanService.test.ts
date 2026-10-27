import { describe, expect, it } from 'vitest'
import type { FinanceDebt } from '../features/finance/debtTypes'
import type { FinanceData, FinanceTransaction } from '../features/finance/financeTypes'
import { debtRemainingCents, projectDebtPlan, validSettlementQuote, advanceDebtDate } from './debtPlanService'
import { debtPlanAvailableCents, debtPlanBalanceCents } from './debtPlanBalance'
import { calculateFinanceMetrics } from './financeService'

const today = new Date(2026, 9, 14)
const debt = (overrides: Partial<FinanceDebt> = {}): FinanceDebt => ({ id: 'moto', name: 'Moto', creditor: 'Crédito', kind: 'loan', status: 'active', balanceCents: 1450000,
  balanceDate: '2026-10-14', paymentCents: 85000, frequency: 'weekly', nextPaymentDate: '2026-10-17', agreementStatus: 'none', priority: 0, createdAt: '', updatedAt: '', ...overrides })
const movement = (overrides: Partial<FinanceTransaction> = {}): FinanceTransaction => ({ id: crypto.randomUUID(), accountId: 'bank', type: 'expense', amountCents: 85000,
  transactionDate: '2026-10-17', description: 'Moto', status: 'completed', debtId: 'moto', createdAt: '', updatedAt: '', ...overrides })
const data = (debts: FinanceDebt[] = [debt()], transactions: FinanceTransaction[] = []): FinanceData => ({
  accounts: [{ id: 'bank', name: 'Banco', type: 'checking', currency: 'MXN', initialBalanceCents: 10000000, isActive: true, createdAt: '', updatedAt: '' }],
  categories: [], transactions, recurring: [], recurringOccurrences: [], budgets: [], goals: [], contributions: [], budgetClosures: [], savingsFundEntries: [], goalItems: [],
  liquidityPreference: { minimumOperatingBufferCents: 180000 }, liquiditySnapshots: [],
  debtPlan: { debts, entries: [], preferences: { monthlyContributionCents: 0, contributionDay: 15, targetDate: '2026-12-31', strategy: 'balanced' } },
})

describe('debt snapshots and linked payments', () => {
  it('only reduces the snapshot for completed payments on or after its date', () => {
    const source = data([debt()], [movement({ transactionDate: '2026-10-13' }), movement(), movement({ status: 'planned' }), movement({ status: 'cancelled' })])
    expect(debtRemainingCents(debt(), source)).toBe(1365000)
  })
  it('separates capital from interest and handles settlement discounts', () => {
    const source = data([debt()], [movement({ debtPrincipalCents: 50000 })])
    expect(debtRemainingCents(debt(), source)).toBe(1400000)
    source.transactions.push(movement({ amountCents: 800000, debtSettlement: true }))
    expect(debtRemainingCents(debt(), source)).toBe(0)
  })
  it('restores the balance on undo or deletion, including a settlement', () => {
    const source = data([debt()], [movement({ debtSettlement: true })])
    expect(debtRemainingCents(debt(), source)).toBe(0)
    source.transactions[0].status = 'cancelled'
    expect(debtRemainingCents(debt(), source)).toBe(1450000)
    source.transactions = []
    expect(debtRemainingCents(debt(), source)).toBe(1450000)
  })
  it('does not invent an ongoing discount from an expired or changed quote', () => {
    const purchase = debt({ kind: 'purchase', settlementCents: 580000, quoteDate: '2026-10-14', quoteValidUntil: '2026-10-20' })
    expect(validSettlementQuote(purchase, data(), '2026-10-20')).toBe(true)
    expect(validSettlementQuote(purchase, data(), '2026-10-21')).toBe(false)
    expect(validSettlementQuote(purchase, data([purchase], [movement({ transactionDate: '2026-10-15' })]), '2026-10-16')).toBe(false)
    expect(validSettlementQuote({ ...purchase, quoteValidUntil: undefined }, data(), '2026-10-15')).toBe(false)
  })
})

describe('Plan reservation and real expenses', () => {
  it('reserves money without creating an expense, and spends it exactly once', () => {
    const source = data()
    source.debtPlan!.entries.push({ id: 'allocation', accountId: 'bank', amountCents: 200000, entryDate: '2026-10-14', createdAt: '' })
    expect(debtPlanBalanceCents(source)).toBe(200000)
    expect(calculateFinanceMetrics(source, today, today).availableBalanceCents).toBe(9800000)
    source.transactions.push(movement({ transactionDate: '2026-10-14', amountCents: 100000, planAmountCents: 100000 }))
    expect(debtPlanBalanceCents(source)).toBe(100000)
    expect(calculateFinanceMetrics(source, today, today).availableBalanceCents).toBe(9800000)
    expect(calculateFinanceMetrics(source, today, today).monthlyExpensesCents).toBe(100000)
    source.transactions = []
    expect(debtPlanBalanceCents(source)).toBe(200000)
  })
  it('keeps account reservations separate and supports releasing money', () => {
    const source = data()
    source.debtPlan!.entries.push({ id: 'a', accountId: 'bank', amountCents: 200000, entryDate: '2026-10-14', createdAt: '' }, { id: 'b', accountId: 'other', amountCents: 50000, entryDate: '2026-10-14', createdAt: '' }, { id: 'c', accountId: 'bank', amountCents: -30000, entryDate: '2026-10-14', createdAt: '' })
    expect(debtPlanBalanceCents(source, 'bank')).toBe(170000)
    expect(debtPlanBalanceCents(source, 'other')).toBe(50000)
  })
  it('does not spend reservations from an archived account in a new plan', () => {
    const source = data()
    source.debtPlan!.entries.push({ id: 'fund', accountId: 'bank', amountCents: 100000, entryDate: '2026-10-14', createdAt: '' })
    source.accounts[0].isActive = false
    expect(debtPlanBalanceCents(source)).toBe(100000)
    expect(debtPlanAvailableCents(source)).toBe(0)
    expect(projectDebtPlan(source, { reference: today }).events.some(event => event.kind === 'extra')).toBe(false)
  })
})

describe('debt calendar and scenarios', () => {
  it('uses actual Saturdays, caps the final installment and never creates negative debt', () => {
    const projected = projectDebtPlan(data(), { reference: today, strategy: 'minimum' })
    expect(projected.events).toHaveLength(18)
    expect(projected.events.every(event => parseInt(formatWeekday(event.date), 10) === 6)).toBe(true)
    expect(projected.events.at(-1)?.amountCents).toBe(5000)
    expect(projected.totalPaidCents).toBe(1450000)
    expect(projected.remainingCents).toBe(0)
  })
  it('keeps month-end schedules anchored on the original day', () => {
    expect(advanceDebtDate('2027-01-31', 'monthly', 31)).toBe('2027-02-28')
    expect(advanceDebtDate('2027-02-28', 'monthly', 31)).toBe('2027-03-31')
  })
  it('accelerates with reserved money without inventing interest savings', () => {
    const source = data()
    source.debtPlan!.entries.push({ id: 'fund', accountId: 'bank', amountCents: 300000, entryDate: '2026-10-14', createdAt: '' })
    const baseline = projectDebtPlan(source, { reference: today, strategy: 'minimum' })
    const plan = projectDebtPlan(source, { reference: today, strategy: 'balanced' })
    expect(plan.finishDate! < baseline.finishDate!).toBe(true)
    expect(plan.totalPaidCents).toBe(1450000)
    expect(plan.avoidedCostCents).toBe(0)
  })
  it('does not count a linked recurring installment or movement twice', () => {
    const source = data([debt({ balanceCents: 170000 })])
    source.recurring = [{ id: 'weekly', debtId: 'moto', accountId: 'bank', type: 'expense', amountCents: 85000, description: 'Moto', frequency: 'weekly', startDate: '2026-10-17', nextOccurrence: '2026-10-17', isActive: true, createdAt: '', updatedAt: '' }]
    source.recurringOccurrences = [{ id: 'oct17', recurringTransactionId: 'weekly', period: '2026-10-01', expectedDate: '2026-10-17', amountCents: 85000, status: 'pending', createdAt: '', updatedAt: '' }, { id: 'oct24', recurringTransactionId: 'weekly', period: '2026-10-01', expectedDate: '2026-10-24', amountCents: 85000, status: 'pending', createdAt: '', updatedAt: '' }]
    source.transactions = [movement({ status: 'planned', recurringTransactionId: 'weekly' })]
    const plan = projectDebtPlan(source, { reference: today, strategy: 'minimum' })
    expect(plan.events).toHaveLength(2)
    expect(plan.totalPaidCents).toBe(170000)
    expect(plan.days.find(day => day.date === '2026-10-24')?.balanceCents).toBe(9830000)
  })
  it('does not simulate extra payments through the protected buffer', () => {
    const source = data()
    source.accounts[0].initialBalanceCents = 200000
    source.debtPlan!.entries.push({ id: 'fund', accountId: 'bank', amountCents: 100000, entryDate: '2026-10-14', createdAt: '' })
    const plan = projectDebtPlan(source, { reference: today, strategy: 'balanced' })
    expect(plan.events.some(event => event.kind === 'extra')).toBe(false)
    expect(plan.warnings.some(warning => warning.includes('colchón'))).toBe(true)
  })
  it('releases a liquidated debt’s future installments when checking the buffer', () => {
    const source = data()
    source.accounts[0].initialBalanceCents = 3000000
    source.liquidityPreference.minimumOperatingBufferCents = 1500000
    source.debtPlan!.entries.push({ id: 'all', accountId: 'bank', amountCents: 1450000, entryDate: '2026-10-14', createdAt: '' })
    const plan = projectDebtPlan(source, { reference: today })
    expect(plan.finishDate).toBe('2026-10-14')
    expect(plan.minimumCashCents).toBe(1550000)
  })
  it('keeps linked payments covered by a category budget exactly once', () => {
    const source = data([debt({ balanceCents: 85000 })], [movement({ status: 'planned', categoryId: 'debt-category' })])
    source.categories = [{ id: 'debt-category', name: 'Deudas', type: 'expense', isActive: true, isDefault: true }]
    source.budgets = [{ id: 'budget', categoryId: 'debt-category', month: '2026-10-01', periodStart: '2026-10-16', periodEnd: '2026-10-31', plannedAmountCents: 100000, createdAt: '', updatedAt: '' }]
    const plan = projectDebtPlan(source, { reference: today, strategy: 'minimum' })
    expect(plan.days.find(day => day.date === '2026-10-18')?.balanceCents).toBe(9900000)
  })
  it('uses the latest configured recurring amount for unconfigured future months', () => {
    const source = data()
    source.recurring = [{ id: 'weekly', debtId: 'moto', accountId: 'bank', type: 'expense', amountCents: 85000, description: 'Moto', frequency: 'weekly', startDate: '2026-10-17', nextOccurrence: '2026-10-17', isActive: true, createdAt: '', updatedAt: '' }]
    source.recurringOccurrences = [{ id: 'oct', recurringTransactionId: 'weekly', period: '2026-10-01', expectedDate: '2026-10-17', amountCents: 130000, status: 'pending', createdAt: '', updatedAt: '' }]
    const plan = projectDebtPlan(source, { reference: today, strategy: 'minimum' })
    expect(plan.events.find(event => event.date === '2026-11-07')?.amountCents).toBe(130000)
  })
  it('only uses confirmed agreements and does not promise the same discount twice', () => {
    const proposed = debt({ id: 'plata', kind: 'negotiable', balanceCents: 900000, paymentCents: 300000, frequency: 'monthly', agreementCents: 600000, agreementPayments: 3, agreementStatus: 'proposed' })
    expect(projectDebtPlan(data([proposed]), { reference: today }).totalPaidCents).toBe(900000)
    const confirmed = { ...proposed, agreementStatus: 'confirmed' as const }
    const plan = projectDebtPlan(data([confirmed]), { reference: today })
    expect(plan.totalPaidCents).toBe(600000)
    expect(plan.avoidedCostCents).toBe(300000)
  })
  it('does not apply pre-agreement payments to a newly negotiated total', () => {
    const confirmed = debt({ id: 'plata', kind: 'negotiable', balanceCents: 900000, agreementCents: 600000, agreementPayments: 3, agreementStatus: 'confirmed', agreementDate: '2026-10-20' })
    const source = data([confirmed], [movement({ debtId: 'plata', amountCents: 100000, transactionDate: '2026-10-17' })])
    expect(debtRemainingCents(confirmed, source)).toBe(600000)
    source.transactions.push(movement({ debtId: 'plata', amountCents: 200000, transactionDate: '2026-10-21' }))
    expect(debtRemainingCents(confirmed, source)).toBe(400000)
  })
  it('prioritizes the greatest confirmed peso saving when only one quote fits', () => {
    const samsung = debt({ id: 'samsung', kind: 'purchase', balanceCents: 792000, paymentCents: 65000, nextPaymentDate: '2026-10-20', frequency: 'monthly', settlementCents: 580000, quoteDate: '2026-10-14' })
    const comedor = debt({ id: 'comedor', kind: 'purchase', balanceCents: 448000, paymentCents: 45000, nextPaymentDate: '2026-10-25', frequency: 'monthly', settlementCents: 320000, quoteDate: '2026-10-14' })
    const source = data([samsung, comedor])
    source.debtPlan!.entries.push({ id: 'plan', accountId: 'bank', amountCents: 800000, entryDate: '2026-10-14', createdAt: '' })
    expect(projectDebtPlan(source, { reference: today }).events[0]).toMatchObject({ debtId: 'samsung', amountCents: 580000, kind: 'settlement' })
  })
  it('skips paused and archived debts and exposes a horizon with no false payoff date', () => {
    const long = debt({ paymentCents: 100, frequency: 'monthly' })
    const plan = projectDebtPlan(data([long, debt({ id: 'paused', status: 'paused' }), debt({ id: 'archive', status: 'archived' })]), { reference: today })
    expect(plan.finishDate).toBeUndefined()
    expect(plan.remainingCents).toBeGreaterThan(0)
    expect(plan.events.every(event => event.debtId === 'moto')).toBe(true)
  })
})

function formatWeekday(date: string) { return String(new Date(`${date}T12:00:00`).getDay()) }

describe('dated balances, creditor corrections and simulations', () => {
  it('retains interest increases and removes the adjustment when a payment is undone', () => {
    const source = data([debt()], [movement({ debtBalanceAdjustmentCents: 12000 })])
    expect(debtRemainingCents(debt(), source)).toBe(1377000)
    source.transactions[0].status = 'cancelled'
    expect(debtRemainingCents(debt(), source)).toBe(1450000)
  })
  it('refreshes a quote after paying, invalidates it after the next payment, and restores it on undo', () => {
    const purchase = debt({ kind: 'purchase', settlementCents: 580000, quoteDate: '2026-10-14' })
    const source = data([purchase], [movement({ id: 'first', debtQuoteCents: 590000, debtQuoteValidUntil: '2026-10-22', createdAt: '2026-10-17T10:00:00Z' })])
    expect(validSettlementQuote(purchase, source, '2026-10-20')).toBe(true)
    source.transactions.push(movement({ id: 'second', transactionDate: '2026-10-18' }))
    expect(validSettlementQuote(purchase, source, '2026-10-20')).toBe(false)
    source.transactions.pop()
    expect(validSettlementQuote(purchase, source, '2026-10-20')).toBe(true)
    source.transactions = []
    expect(validSettlementQuote(purchase, source, '2026-10-20')).toBe(false)
  })
  it('tracks the debt remaining on each date separately from cash', () => {
    const plan = projectDebtPlan(data(), { reference: today, strategy: 'minimum' })
    expect(plan.days.find(day => day.date === '2026-10-16')?.debtCents).toBe(1450000)
    expect(plan.days.find(day => day.date === '2026-10-17')?.debtCents).toBe(1365000)
    expect(plan.days.find(day => day.date === '2026-10-24')?.debtCents).toBe(1280000)
  })
  it('simulates a dated payoff after the regular installment without changing real data', () => {
    const source = data()
    const original = structuredClone(source)
    const plan = projectDebtPlan(source, { reference: today, strategy: 'minimum',
      oneTimePayment: { debtId: 'moto', date: '2026-10-24', amountCents: 1200000, settles: true } })
    expect(plan.events.filter(event => event.date === '2026-10-24').map(event => event.remainingCents)).toEqual([1280000, 0])
    expect(plan.payoffDates.moto).toBe('2026-10-24')
    expect(plan.totalPaidCents).toBe(1370000)
    expect(plan.days.find(day => day.date === '2026-10-24')?.debtCents).toBe(0)
    expect(source).toEqual(original)
  })
  it('uses extra money for Coppel before the motorcycle when priorities match', () => {
    const source = data([debt({ id: 'moto' }), debt({ id: 'coppel', kind: 'purchase', balanceCents: 200000 })])
    source.debtPlan!.entries.push({ id: 'fund', accountId: 'bank', amountCents: 250000, entryDate: '2026-10-14', createdAt: '' })
    const plan = projectDebtPlan(source, { reference: today })
    expect(plan.events[0].debtId).toBe('coppel')
    expect(plan.events[0].closes).toBe(true)
  })
})
