import { describe, expect, it } from 'vitest'
import type { FinanceDebt } from '../features/finance/debtTypes'
import type { FinanceData, FinanceTransaction } from '../features/finance/financeTypes'
import { FINANCE_LIQUIDITY_PROJECTION_VERSION, financeLiquidityProjection } from './financeLiquidityProjection'
import { buildFinanceDecisionReport, evaluateFinancePurchase, planFinanceSinkingFund } from './financeDecisionTools'

const createdAt = '2026-01-01T12:00:00.000Z'
const reference = new Date(2026, 9, 30)
const transaction = (overrides: Partial<FinanceTransaction>): FinanceTransaction => ({
  id: 'expense', accountId: 'account', type: 'expense', amountCents: 100_000,
  transactionDate: '2026-10-31', description: 'Gasto', status: 'planned', createdAt, updatedAt: createdAt,
  ...overrides,
})
const finance = (transactions: FinanceTransaction[] = []): FinanceData => ({
  accounts: [{ id: 'account', name: 'Operativa', type: 'checking', currency: 'MXN', initialBalanceCents: 1_000_000, isActive: true, createdAt, updatedAt: createdAt }],
  transactions, categories: [], recurring: [], recurringOccurrences: [], budgets: [], goals: [], contributions: [], budgetClosures: [], savingsFundEntries: [], goalItems: [],
  liquidityPreference: { minimumOperatingBufferCents: 200_000 }, liquiditySnapshots: [],
})
const debt = (overrides: Partial<FinanceDebt> = {}): FinanceDebt => ({
  id: 'moto', name: 'Moto', creditor: 'Ventocredit', kind: 'purchase', status: 'active',
  balanceCents: 500_000, balanceDate: '2026-10-01', paymentCents: 90_600, frequency: 'weekly', nextPaymentDate: '2026-10-24', agreementStatus: 'none', priority: 1, createdAt, updatedAt: createdAt,
  ...overrides,
})
function withDebt(data: FinanceData, debts: FinanceDebt[]) {
  data.debtPlan = { debts, entries: [], preferences: { contributionDay: 15, monthlyContributionCents: 0, targetDate: '2026-12-31', strategy: 'balanced' } }
  return data
}
const report = (data: FinanceData, options: Partial<Parameters<typeof buildFinanceDecisionReport>[1]> = {}) => buildFinanceDecisionReport(data, { reference, horizonDays: 90, ...options })

describe('financial decision reports', () => {
  it('uses the exact official monthly curve and retains event source provenance across month boundaries', () => {
    const data = finance([
      transaction({ id: 'paid-today', status: 'completed', transactionDate: '2026-10-30', amountCents: 20_000 }),
      transaction({ id: 'overdue', transactionDate: '2026-10-29', amountCents: 30_000 }),
      transaction({ id: 'november', transactionDate: '2026-11-05' }),
    ])
    const actual = report(data)
    const november = financeLiquidityProjection({ data, month: new Date(2026, 10, 1), referenceDate: reference, currentAvailableBalanceCents: 980_000, minimumOperatingBufferCents: 200_000, includePersonalBudgetReservations: true })
    expect(actual.scenarios.base.days.find(day => day.date === '2026-11-05')?.balanceCents).toBe(november.days.find(day => day.date === '2026-11-05')?.balanceCents)
    expect(actual.scenarios.base.events.find(item => item.id === 'movement:paid-today')).toMatchObject({ evidence: 'actual', amountCents: -20_000 })
    expect(actual.scenarios.base.events.find(item => item.id === 'movement:overdue')).toMatchObject({ evidence: 'commitment', date: '2026-10-30', originalDate: '2026-10-29', isOverdue: true })
    expect(actual.scenarios.base.days[0].balanceCents).toBe(950_000)
  })

  it('delays entire future income, changes only pending spending, and preserves the ledger', () => {
    const data = finance([
      transaction({ id: 'actual', status: 'completed', amountCents: 40_000, transactionDate: '2026-10-30' }),
      transaction({ id: 'salary', type: 'income', amountCents: 500_000, transactionDate: '2026-10-31' }),
      transaction({ id: 'food', amountCents: 100_000, transactionDate: '2026-11-01' }),
      transaction({ id: 'saving', type: 'saving', amountCents: 10_000, transactionDate: '2026-11-01' }),
    ])
    const before = JSON.stringify(data)
    const result = report(data)
    expect(result.scenarios.conservative.events.find(item => item.id === 'movement:salary')).toMatchObject({ date: '2026-11-07', amountCents: 500_000 })
    expect(result.scenarios.conservative.events.find(item => item.id === 'movement:food')?.amountCents).toBe(-110_000)
    expect(result.scenarios.conservative.events.find(item => item.id === 'movement:actual')?.amountCents).toBe(-40_000)
    expect(result.scenarios.conservative.events.find(item => item.id === 'movement:saving')?.amountCents).toBe(-10_000)
    expect(result.scenarios.conservative.days[0].balanceCents).toBe(960_000)
    expect(JSON.stringify(data)).toBe(before)
  })

  it('removes income delayed past the horizon rather than making it available early', () => {
    const data = finance([transaction({ id: 'salary', type: 'income', amountCents: 500_000, transactionDate: '2026-10-31' })])
    const result = report(data, { horizonDays: 3, conservativeDelayDays: 7 })
    expect(result.scenarios.base.closingBalanceCents).toBe(1_500_000)
    expect(result.scenarios.conservative.closingBalanceCents).toBe(1_000_000)
    expect(result.scenarios.conservative.events).toHaveLength(0)
  })

  it('stress excludes precisely the selected future income and adds the explicit expense once', () => {
    const data = finance([
      transaction({ id: 'salary', type: 'income', amountCents: 500_000, transactionDate: '2026-11-02' }),
      transaction({ id: 'extra', type: 'income', amountCents: 200_000, transactionDate: '2026-11-03' }),
    ])
    const result = report(data, { stressMissedIncomeId: 'movement:extra', stressExpenseCents: 50_000 })
    expect(result.scenarios.conservative.closingBalanceCents).toBe(1_700_000)
    expect(result.scenarios.stress.closingBalanceCents).toBe(1_450_000)
    expect(result.scenarios.stress.events.filter(item => item.id === 'decision:unexpected-expense')).toHaveLength(1)
    expect(result.scenarios.stress.events.some(item => item.id === 'movement:salary')).toBe(true)
    expect(result.scenarios.stress.events.some(item => item.id === 'movement:extra')).toBe(false)
  })

  it('labels a saved simulation overlay as an estimate and never as an actual or real commitment', () => {
    const data = finance([transaction({ id: 'simulation:purchase-1', description: 'Laptop · simulación' })])
    const result = report(data)
    expect(result.scenarios.base.events[0]).toMatchObject({ evidence: 'estimate', originLabel: 'Simulación guardada' })
    expect(result.scenarios.conservative.events[0].amountCents).toBe(-110_000)
  })

  it('keeps debt installments unchanged and never turns a stale calendar into arrears', () => {
    const result = report(withDebt(finance(), [debt()]))
    const base = result.scenarios.base.events.filter(item => item.source === 'debt')
    expect(base[0]).toMatchObject({ date: '2026-10-31', amountCents: -90_600, evidence: 'estimate' })
    expect(result.scenarios.conservative.events.filter(item => item.source === 'debt')).toEqual(base)
    expect(base.reduce((sum, event) => sum - event.amountCents, 0)).toBe(500_000)
    expect(result.debts.highestCostAvailable).toBe(false)
    expect(result.debts.candidates[0].knownSavingsCents).toBeUndefined()
  })

  it('subtracts only uncommitted budget remainder and does not duplicate the dated expense', () => {
    const data = finance([transaction({ id: 'dated', categoryId: 'personal', amountCents: 100_000, transactionDate: '2026-11-05' })])
    data.categories = [{ id: 'personal', name: 'Personal', type: 'expense', isActive: true, isDefault: false }]
    data.budgets = [{ id: 'budget', categoryId: 'personal', name: 'Gastos Personales', month: '2026-11-01', periodStart: '2026-11-01', periodEnd: '2026-11-15', plannedAmountCents: 300_000, createdAt, updatedAt: createdAt }]
    const result = report(data, { conservativeExpensePercent: 0 })
    expect(result.scenarios.base.closingBalanceCents).toBe(700_000)
    expect(result.scenarios.base.events.find(item => item.source === 'budget')).toMatchObject({ amountCents: -200_000, evidence: 'estimate' })
  })

  it('compares known valid quotes and invalidates a quote when a subsequent payment changes its basis', () => {
    const data = withDebt(finance(), [debt({ settlementCents: 300_000, quoteDate: '2026-10-29', quoteValidUntil: '2026-11-05' })])
    const first = report(data).debts.candidates[0]
    expect(first).toMatchObject({ settlementSource: 'valid_quote', settlementCents: 300_000, knownSavingsCents: 200_000 })
    data.transactions.push(transaction({ debtId: 'moto', type: 'debt_payment', amountCents: 10_000, status: 'completed', transactionDate: '2026-10-30' }))
    const changed = report(data).debts.candidates[0]
    expect(changed).toMatchObject({ settlementSource: 'remaining_balance', settlementCents: 490_000 })
    expect(changed.knownSavingsCents).toBeUndefined()
    expect(report(withDebt(finance(), [debt({ settlementCents: 300_000, quoteDate: '2026-10-01', quoteValidUntil: '2026-10-29' })])).debts.candidates[0].knownSavingsCents).toBeUndefined()
  })

  it('preserves snapshot gaps instead of claiming calibrated backtesting or inventing a reason for drift', () => {
    const data = finance([transaction({ id: 'sep', status: 'completed', transactionDate: '2026-09-15', amountCents: 100_000 })])
    data.liquiditySnapshots = [
      { id: 'sep', month: '2026-09-01', snapshotDate: '2026-09-01T12:00:00Z', projectionVersion: FINANCE_LIQUIDITY_PROJECTION_VERSION, initialProjectedClosingBalanceCents: 950_000, initialProjectedMinimumCents: 900_000 },
      { id: 'old', month: '2026-08-01', snapshotDate: '2026-08-02', projectionVersion: 1, initialProjectedClosingBalanceCents: 123, initialProjectedMinimumCents: 123 },
      { id: 'open', month: '2026-10-01', snapshotDate: '2026-10-01', projectionVersion: FINANCE_LIQUIDITY_PROJECTION_VERSION, initialProjectedClosingBalanceCents: 123, initialProjectedMinimumCents: 123 },
    ]
    const audit = report(data).audit
    expect(audit.entries.find(item => item.id === 'sep')).toMatchObject({ status: 'reconstructed', actualClosingCents: 900_000, differenceCents: -50_000 })
    expect(audit.entries.find(item => item.id === 'old')?.status).toBe('incompatible')
    expect(audit.entries.find(item => item.id === 'old')?.differenceCents).toBeUndefined()
    expect(audit.entries.find(item => item.id === 'open')?.status).toBe('open')
    expect(audit.meanAbsoluteErrorCents).toBeUndefined()
    expect(audit.evidenceGaps.length).toBeGreaterThan(0)
  })

  it('uses only a matched completed recurrence as evidence of date and amount error', () => {
    const data = finance([transaction({ id: 'salary-paid', status: 'completed', type: 'income', transactionDate: '2026-10-03', amountCents: 99_000 })])
    data.recurring = [{ id: 'salary', accountId: 'account', description: 'Nómina', type: 'income', amountCents: 100_000, frequency: 'monthly', startDate: '2026-01-01', nextOccurrence: '2026-11-01', isActive: true, createdAt, updatedAt: createdAt }]
    data.recurringOccurrences = [{ id: 'salary-oct', recurringTransactionId: 'salary', period: '2026-10-01', expectedDate: '2026-10-01', amountCents: 100_000, status: 'paid', transactionId: 'salary-paid', createdAt, updatedAt: createdAt }]
    expect(report(data).audit).toMatchObject({ observedIncomeDelayDays: 2, meanAbsoluteRecurringErrorCents: 1000, recurringComparisons: [{ expectedCents: 100_000, actualCents: 99_000, delayDays: 2 }] })
  })

  it('requires three completed history months for a buffer reference and ignores planned spending', () => {
    const data = finance([
      transaction({ id: 'jul-in', status: 'completed', type: 'income', transactionDate: '2026-07-01', amountCents: 200_000 }),
      transaction({ id: 'jul-out', status: 'completed', transactionDate: '2026-07-15', amountCents: 350_000 }),
      transaction({ id: 'aug-out', status: 'completed', transactionDate: '2026-08-15', amountCents: 100_000 }),
      transaction({ id: 'sep-plan', status: 'planned', transactionDate: '2026-09-15', amountCents: 900_000 }),
    ])
    expect(report(data).buffer).toMatchObject({ historyMonths: 2, suggestedCents: undefined, maximumObservedDrawdownCents: 350_000, configuredCents: 200_000 })
    data.transactions.push(transaction({ id: 'sep-out', status: 'completed', transactionDate: '2026-09-15', amountCents: 80_000 }))
    expect(report(data).buffer).toMatchObject({ historyMonths: 3, suggestedCents: 350_000 })
  })

  it('caps horizons and rejects invalid currency, dates and stress inputs', () => {
    expect(report(finance(), { horizonDays: 1000 }).horizonDays).toBe(366)
    expect(() => report(finance(), { stressExpenseCents: 1.5 })).toThrow()
    expect(() => report(finance(), { horizonDays: 0 })).toThrow()
    expect(() => report(finance(), { conservativeExpensePercent: Infinity })).toThrow()
    expect(() => report(finance(), { reference: new Date(NaN) })).toThrow()
  })
})

describe('purchase and sinking fund evaluators', () => {
  it('finds the first safe purchase date using all subsequent daily balances, not just the balance that day', () => {
    const data = finance([
      transaction({ id: 'rent', amountCents: 700_000, transactionDate: '2026-11-02' }),
      transaction({ id: 'salary', type: 'income', amountCents: 600_000, transactionDate: '2026-11-05' }),
    ])
    const result = report(data, { conservativeDelayDays: 0, conservativeExpensePercent: 0 })
    expect(evaluateFinancePurchase(result, 200_000, '2026-10-30')).toMatchObject({ safe: false, capacityOnDateCents: 100_000, bestSafeDate: '2026-11-05', minimumAfterCents: 100_000 })
    expect(evaluateFinancePurchase(result, 200_000, '2026-11-05')).toMatchObject({ safe: true, capacityOnDateCents: 700_000 })
    expect(evaluateFinancePurchase(result, 800_000).bestSafeDate).toBeUndefined()
    expect(() => evaluateFinancePurchase(result, -1)).toThrow()
    expect(() => evaluateFinancePurchase(result, 10, '2026-02-30')).toThrow()
    expect(() => evaluateFinancePurchase(result, 10, '2026-10-29')).toThrow()
  })

  it('splits exact cents into weekly reservations, counts existing savings once and tests the whole schedule', () => {
    const result = report(finance())
    const plan = planFinanceSinkingFund(result, { name: ' Seguro ', targetCents: 100_001, alreadySavedCents: 20_000, dueDate: '2026-11-13' })
    expect(plan).toMatchObject({ name: 'Seguro', remainingCents: 80_001, weeksRemaining: 3, weeklyCents: 26_667, fitsBuffer: true, withinHorizon: true, minimumAfterCents: 919_999 })
    expect(plan.schedule.reduce((sum, payment) => sum + payment.amountCents, 0)).toBe(80_001)
    expect(plan.schedule.map(payment => payment.date)).toEqual(['2026-10-30', '2026-11-06', '2026-11-13'])
    const unsafe = planFinanceSinkingFund(result, { name: 'Compra', targetCents: 900_000, alreadySavedCents: 0, dueDate: '2026-10-30' })
    expect(unsafe.fitsBuffer).toBe(false)
  })

  it('does not certify a fund beyond the projection horizon and rejects stale or malformed target dates', () => {
    const result = report(finance(), { horizonDays: 30 })
    expect(planFinanceSinkingFund(result, { name: 'Seguro', targetCents: 50_000, alreadySavedCents: 0, dueDate: '2027-06-01' })).toMatchObject({ withinHorizon: false, fitsBuffer: false })
    expect(() => planFinanceSinkingFund(result, { name: 'Seguro', targetCents: 50_000, alreadySavedCents: 0, dueDate: '2026-10-29' })).toThrow()
    expect(() => planFinanceSinkingFund(result, { name: '', targetCents: 50_000, alreadySavedCents: 0, dueDate: '2026-11-01' })).toThrow()
  })
})
