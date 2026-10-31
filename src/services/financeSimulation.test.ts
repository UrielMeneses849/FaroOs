import { describe, expect, it } from 'vitest'
import type { FinanceData, FinanceTransaction } from '../features/finance/financeTypes'
import { defaultDebtPlanPreferences } from '../features/finance/debtTypes'
import { scheduledDebtPayments, debtRemainingCents } from './debtSchedule'
import { accountBalance } from './financeService'
import { financeLiquidityProjection } from './financeLiquidityProjection'
import {
  applyFinanceSimulation,
  createFinanceSimulationState,
  financeSimulationStorageKey,
  parseFinanceSimulationState,
  validateFinanceSimulationItem,
  type FinanceSimulationItem,
  type FinanceSimulationState,
} from './financeSimulation'

const reference = new Date(2026, 9, 31)
const timestamp = '2026-10-01T00:00:00.000Z'
const data = (): FinanceData => ({
  accounts: [{ id: 'bank', name: 'Banco', type: 'checking', currency: 'MXN', initialBalanceCents: 1_000_000, isActive: true, createdAt: timestamp, updatedAt: timestamp }],
  categories: [], transactions: [], recurring: [], recurringOccurrences: [], budgets: [], goals: [], contributions: [], budgetClosures: [], savingsFundEntries: [], goalItems: [],
  liquidityPreference: { minimumOperatingBufferCents: 0 }, liquiditySnapshots: [],
  debtPlan: { entries: [], preferences: defaultDebtPlanPreferences(), debts: [{ id: 'moto', name: 'Moto', creditor: 'Crédito', kind: 'purchase', status: 'active', balanceCents: 500_000, balanceDate: '2026-10-29', paymentCents: 85_000, frequency: 'weekly', nextPaymentDate: '2026-10-31', agreementStatus: 'none', priority: 0, createdAt: timestamp, updatedAt: timestamp }] },
})
const item = (overrides: Partial<FinanceSimulationItem> = {}): FinanceSimulationItem => ({ id: 'idea', kind: 'expense', date: '2026-11-03', amountCents: 10_000, accountId: 'bank', description: 'Compra', ...overrides })
const state = (...items: FinanceSimulationItem[]): FinanceSimulationState => ({ version: 1, enabled: true, items })
const debtPayment = (overrides: Partial<FinanceSimulationItem> = {}) => item({ kind: 'debt_payment', debtId: 'moto', date: '2026-11-07', amountCents: 200_000, ...overrides })
const transaction = (overrides: Partial<FinanceTransaction> = {}): FinanceTransaction => ({ id: 'real', accountId: 'bank', debtId: 'moto', type: 'debt_payment', transactionDate: '2026-11-07', amountCents: 85_000, description: 'Pago real programado', status: 'planned', createdAt: timestamp, updatedAt: timestamp, ...overrides })
const november = (source: FinanceData) => financeLiquidityProjection({ data: source, month: new Date(2026, 10, 1), referenceDate: reference, currentAvailableBalanceCents: 1_000_000, minimumOperatingBufferCents: 0 })
function withLinkedCalendar(source = data()) {
  source.recurring = [{ id: 'weekly', accountId: 'bank', debtId: 'moto', type: 'expense', amountCents: 85_000, description: 'Pago semanal', frequency: 'weekly', nextOccurrence: '2026-10-31', startDate: '2026-10-31', isActive: true, createdAt: timestamp, updatedAt: timestamp }]
  source.recurringOccurrences = ['2026-10-31', '2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28', '2026-12-05'].map(date => ({ id: date, recurringTransactionId: 'weekly', period: `${date.slice(0, 7)}-01`, expectedDate: date, amountCents: 85_000, status: 'pending', createdAt: timestamp, updatedAt: timestamp }))
  return source
}

describe('isolated finance simulation overlay', () => {
  it('returns the exact real object when switched off, even with saved ideas', () => {
    const source = data()
    expect(applyFinanceSimulation(source, { ...state(item()), enabled: false }, reference)).toBe(source)
    expect(applyFinanceSimulation(source, createFinanceSimulationState(), reference)).toBe(source)
  })

  it('changes forecast cash on the selected date while preserving actual balances and every real record', () => {
    const source = data()
    source.debtPlan!.debts = []
    const before = structuredClone(source)
    const overlay = applyFinanceSimulation(source, state(item(), item({ id: 'income', kind: 'income', date: '2026-11-05', amountCents: 50_000 })), reference)
    expect(source).toEqual(before)
    expect(overlay.transactions.every(value => value.status === 'planned')).toBe(true)
    expect(accountBalance(source.accounts[0], overlay.transactions)).toBe(1_000_000)
    const projection = november(overlay)
    expect(projection.days.find(day => day.date === '2026-11-03')?.balanceCents).toBe(990_000)
    expect(projection.closingBalanceCents).toBe(1_040_000)
  })

  it('keeps past scenarios and deleted-account ideas out of forecasts instead of creating arrears', () => {
    const source = data()
    const scenario = state(item({ date: '2026-10-30' }), item({ id: 'deleted', accountId: 'gone' }), debtPayment({ id: 'deleted-debt', debtId: 'gone' }))
    expect(applyFinanceSimulation(source, scenario, reference)).toBe(source)
    expect(scenario.items).toHaveLength(3)
  })

  it('replaces a same-day planned installment and counts a full settlement only once', () => {
    const source = data()
    source.transactions = [transaction(), transaction({ id: 'later', transactionDate: '2026-11-14' })]
    const overlay = applyFinanceSimulation(source, state(debtPayment({ settles: true })), reference)
    expect(overlay.transactions).toHaveLength(1)
    expect(overlay.transactions[0]).toMatchObject({ debtSettlement: true, debtPrincipalCents: 200_000, status: 'planned' })
    expect(scheduledDebtPayments(overlay, '2027-01-31', reference).map(payment => payment.date)).toEqual(['2026-10-31'])
    expect(november(overlay).closingBalanceCents).toBe(715_000)
    expect(debtRemainingCents(source.debtPlan!.debts[0], overlay)).toBe(500_000)
    expect(source.transactions).toHaveLength(2)
  })

  it('reduces the final installment after an extra payment without duplicating the scheduled date', () => {
    const source = data()
    const overlay = applyFinanceSimulation(source, state(debtPayment()), reference)
    const schedule = scheduledDebtPayments(overlay, '2027-01-31', reference)
    expect(schedule.map(payment => payment.date)).not.toContain('2026-11-07')
    expect(schedule.at(-1)).toMatchObject({ date: '2026-11-28', amountCents: 45_000 })
    expect(schedule.reduce((sum, payment) => sum + payment.amountCents, 200_000)).toBe(500_000)
    expect(november(overlay).closingBalanceCents).toBe(500_000)
  })

  it('ends linked recurring payments at a payoff, leaving the real weekly calendar untouched', () => {
    const source = withLinkedCalendar()
    const before = structuredClone(source)
    const overlay = applyFinanceSimulation(source, state(debtPayment({ settles: true }), debtPayment({ id: 'unneeded-later-idea', date: '2026-11-21' })), reference)
    expect(source).toEqual(before)
    const projection = november(overlay)
    expect(projection.events.filter(event => event.source === 'recurring')).toEqual([])
    expect(projection.events.filter(event => event.source === 'debt')).toEqual([])
    expect(projection.closingBalanceCents).toBe(715_000)
    expect(overlay.transactions).toHaveLength(1)
    expect(overlay.recurring[0].endDate).toBe('2026-11-07')
    expect(source.recurring[0].endDate).toBeUndefined()
  })

  it('caps linked recurring principal after partial prepayment and preserves completed real payments', () => {
    const source = withLinkedCalendar()
    source.transactions = [transaction({ id: 'paid', status: 'completed', transactionDate: '2026-10-30', amountCents: 50_000 })]
    const overlay = applyFinanceSimulation(source, state(debtPayment()), reference)
    const events = november(overlay).events.filter(event => event.source === 'recurring')
    expect(events.map(event => [event.date, event.amountCents])).toEqual([['2026-11-14', -85_000], ['2026-11-21', -80_000]])
    expect(overlay.transactions).toContain(source.transactions[0])
    expect(source.recurringOccurrences.find(occurrence => occurrence.expectedDate === '2026-11-21')?.amountCents).toBe(85_000)
  })

  it('charges a single terminal payoff when multiple same-day payoff ideas are saved', () => {
    const source = data()
    const scenario = state(debtPayment({ id: 'first-payoff', settles: true }), debtPayment({ id: 'second-payoff', settles: true, amountCents: 250_000 }), debtPayment({ id: 'extra-on-payoff-day', amountCents: 50_000 }))
    const overlay = applyFinanceSimulation(source, scenario, reference)
    expect(overlay.transactions).toHaveLength(1)
    expect(overlay.transactions[0]).toMatchObject({ id: 'simulation:first-payoff', amountCents: 200_000 })
    expect(november(overlay).closingBalanceCents).toBe(715_000)
    expect(scenario.items).toHaveLength(3)
  })

  it('caps explicit future planned installments after an extra, including prior generated installments', () => {
    const source = data()
    source.transactions = ['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28', '2026-12-05'].map((date, index) => transaction({ id: `scheduled-${index}`, transactionDate: date }))
    const before = structuredClone(source)
    const overlay = applyFinanceSimulation(source, state(debtPayment()), reference)
    expect(overlay.transactions.find(value => value.transactionDate === '2026-11-28')).toMatchObject({ amountCents: 45_000, debtPrincipalCents: 45_000 })
    expect(overlay.transactions.some(value => value.transactionDate === '2026-12-05')).toBe(false)
    const estimates = scheduledDebtPayments(overlay, '2027-01-31', reference)
    expect(estimates.map(value => value.date)).toEqual(['2026-10-31'])
    expect(estimates.reduce((total, value) => total + value.amountCents, overlay.transactions.reduce((total, value) => total + value.amountCents, 0))).toBe(500_000)
    expect(november(overlay).closingBalanceCents).toBe(500_000)
    expect(source).toEqual(before)
  })

  it('removes a materialized linked occurrence when its planned installment is no longer needed', () => {
    const source = withLinkedCalendar()
    source.debtPlan!.debts[0].balanceCents = 250_000
    source.transactions = [transaction({ id: 'tail-planned', transactionDate: '2026-11-21' })]
    source.recurringOccurrences.find(value => value.expectedDate === '2026-11-21')!.transactionId = 'tail-planned'
    const overlay = applyFinanceSimulation(source, state(debtPayment({ amountCents: 165_000 })), reference)
    expect(overlay.transactions.some(value => value.id === 'tail-planned')).toBe(false)
    expect(overlay.recurringOccurrences.find(value => value.expectedDate === '2026-11-21')?.status).toBe('skipped')
    expect(november(overlay).events.filter(value => value.source === 'recurring')).toEqual([])
  })
})

describe('simulation persistence schema', () => {
  it('round-trips a versioned scenario and namespaces user ids without collisions', () => {
    const saved = state(item(), debtPayment({ id: 'payoff', settles: true }))
    expect(parseFinanceSimulationState(JSON.stringify(saved))).toEqual(saved)
    expect(financeSimulationStorageKey('one:two')).not.toBe(financeSimulationStorageKey('one%3Atwo'))
  })

  it.each([
    { amountCents: 0 }, { amountCents: -1 }, { amountCents: 1.5 }, { amountCents: Number.MAX_SAFE_INTEGER + 1 },
    { date: '2026-02-30' }, { date: '2026-1-01' }, { description: '  ' }, { accountId: '' },
    { kind: 'debt_payment', debtId: undefined }, { kind: 'expense', settles: true },
  ])('rejects invalid scenario input %j instead of partially saving it', overrides => {
    expect(() => validateFinanceSimulationItem({ ...item(), ...overrides })).toThrow()
  })

  it('rejects corruption, unknown versions, and duplicate ids as complete documents', () => {
    expect(() => parseFinanceSimulationState('{')).toThrow()
    expect(() => parseFinanceSimulationState(JSON.stringify({ ...state(item()), version: 2 }))).toThrow()
    expect(() => parseFinanceSimulationState(JSON.stringify(state(item(), item())))).toThrow()
  })
})
