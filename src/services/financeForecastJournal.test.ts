import { addDays } from 'date-fns'
import { describe, expect, it } from 'vitest'
import type { FinanceData, FinanceTransaction } from '../features/finance/financeTypes'
import { buildFinanceDecisionReport } from './financeDecisionTools'
import { captureFinanceForecastJournal, compareFinanceForecastSnapshot, financeForecastWeek, hasFinanceForecastSnapshotForWeek, loadFinanceForecastJournal } from './financeForecastJournal'

const createdAt = '2026-01-01T12:00:00.000Z'
const reference = new Date(2026, 9, 30, 12)
const transaction = (overrides: Partial<FinanceTransaction>): FinanceTransaction => ({ id: 'expense', accountId: 'account', type: 'expense', amountCents: 100_000, transactionDate: '2026-11-05', description: 'Gasto', status: 'planned', createdAt, updatedAt: createdAt, ...overrides })
const data = (transactions: FinanceTransaction[] = []): FinanceData => ({
  accounts: [{ id: 'account', name: 'Operativa', type: 'checking', currency: 'MXN', initialBalanceCents: 1_000_000, isActive: true, createdAt, updatedAt: createdAt }],
  transactions, categories: [], recurring: [], recurringOccurrences: [], budgets: [], goals: [], contributions: [], budgetClosures: [], savingsFundEntries: [], goalItems: [], liquidityPreference: { minimumOperatingBufferCents: 100_000 }, liquiditySnapshots: [],
})
function memoryStorage() {
  const values = new Map<string, string>()
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

describe('weekly forecast journal', () => {
  it('captures the first week once, preserves its immutable values, and isolates each user', () => {
    const storage = memoryStorage()
    const report = buildFinanceDecisionReport(data([transaction({})]), { reference })
    const first = captureFinanceForecastJournal('user-a', report, reference, storage)
    expect(first.captured).toBe(true)
    expect(first.entries).toHaveLength(1)
    expect(first.entries[0].days).toHaveLength(90)
    report.scenarios.base.events[0].amountCents = -900_000
    expect(captureFinanceForecastJournal('user-a', report, addDays(reference, 1), storage).captured).toBe(false)
    expect(loadFinanceForecastJournal('user-a', storage).entries[0].events[0].amountCents).toBe(-100_000)
    expect(loadFinanceForecastJournal('user-b', storage).entries).toEqual([])
    expect(hasFinanceForecastSnapshotForWeek(first.entries, reference)).toBe(true)
  })

  it('keeps only the latest twenty-six separate weeks and handles ISO-year week boundaries', () => {
    const storage = memoryStorage()
    for (let index = 0; index < 28; index++) {
      const date = addDays(reference, index * 7)
      captureFinanceForecastJournal('user', buildFinanceDecisionReport(data(), { reference: date, horizonDays: 3 }), date, storage)
    }
    const history = loadFinanceForecastJournal('user', storage)
    expect(history.entries).toHaveLength(26)
    expect(history.entries.some(entry => entry.week === financeForecastWeek(reference))).toBe(false)
    expect(financeForecastWeek(new Date(2027, 0, 1))).toBe('2026-W53')
  })

  it('never overwrites malformed existing storage or a quota-limited history', () => {
    const storage = memoryStorage()
    const report = buildFinanceDecisionReport(data(), { reference })
    captureFinanceForecastJournal('user', report, reference, storage)
    const key = [...storage.values.keys()][0]
    storage.values.set(key, '{invalid')
    const bad = captureFinanceForecastJournal('user', report, addDays(reference, 7), storage)
    expect(bad).toMatchObject({ status: 'invalid', captured: false })
    expect(storage.values.get(key)).toBe('{invalid')
    const full = { getItem: () => null, setItem: () => { throw new Error('quota') } }
    expect(captureFinanceForecastJournal('user', report, reference, full)).toMatchObject({ status: 'unavailable', captured: false })
    expect(loadFinanceForecastJournal('', storage).status).toBe('unavailable')
  })

  it('refuses to save hypothetical cash movements as real forecast evidence', () => {
    const storage = memoryStorage()
    const report = buildFinanceDecisionReport(data([transaction({ id: 'simulation:laptop' })]), { reference })
    expect(captureFinanceForecastJournal('user', report, reference, storage)).toMatchObject({ captured: false, entries: [] })
    expect(storage.values.size).toBe(0)
  })

  it('separates changes to future plans from past-day actual ledger comparisons', () => {
    const storage = memoryStorage()
    const original = data([
      transaction({ id: 'changed', transactionDate: '2026-11-05', amountCents: 100_000 }),
      transaction({ id: 'removed', transactionDate: '2026-11-07' }),
      transaction({ id: 'historical', transactionDate: '2026-10-31', amountCents: 50_000 }),
    ])
    const captured = captureFinanceForecastJournal('user', buildFinanceDecisionReport(original, { reference }), reference, storage).entries[0]
    const current = data([
      transaction({ id: 'changed', transactionDate: '2026-11-06', amountCents: 120_000 }),
      transaction({ id: 'new', transactionDate: '2026-11-08' }),
      transaction({ id: 'historical', transactionDate: '2026-10-31', amountCents: 60_000, status: 'completed' }),
    ])
    const result = compareFinanceForecastSnapshot(captured, buildFinanceDecisionReport(current, { reference: new Date(2026, 10, 2) }), current)
    expect(result.changes.find(item => item.id === 'movement:changed')).toMatchObject({ type: 'changed', before: { date: '2026-11-05', amountCents: -100_000 }, after: { date: '2026-11-06', amountCents: -120_000 } })
    expect(result.changes.find(item => item.id === 'movement:removed')?.type).toBe('removed')
    expect(result.changes.find(item => item.id === 'movement:new')?.type).toBe('added')
    expect(result.realizedComparisons.find(item => item.date === '2026-10-31')).toMatchObject({ projectedCents: 950_000, reconstructedCents: 940_000, differenceCents: -10_000 })
    expect(result.unverifiedPastEvents).toBe(1)
    expect(result.explanation).toContain('no demuestra un pago')
  })

  it('reconstructs saving and Plan reservations by their historical dates without spending either twice', () => {
    const storage = memoryStorage()
    const captured = captureFinanceForecastJournal('user', buildFinanceDecisionReport(data(), { reference }), reference, storage).entries[0]
    const current = data([
      transaction({ id: 'saving', type: 'saving', amountCents: 100_000, transactionDate: '2026-10-31', status: 'completed' }),
      transaction({ id: 'debt', type: 'debt_payment', amountCents: 20_000, planAmountCents: 20_000, transactionDate: '2026-11-01', status: 'completed' }),
    ])
    current.debtPlan = { debts: [], entries: [{ id: 'reserve', accountId: 'account', amountCents: 200_000, entryDate: '2026-10-31', createdAt }], preferences: { contributionDay: 15, monthlyContributionCents: 0, targetDate: '2027-01-01', strategy: 'balanced' } }
    const compared = compareFinanceForecastSnapshot(captured, buildFinanceDecisionReport(current, { reference: new Date(2026, 10, 2) }), current)
    expect(compared.realizedComparisons.find(item => item.date === '2026-10-30')?.reconstructedCents).toBe(1_000_000)
    expect(compared.realizedComparisons.find(item => item.date === '2026-10-31')?.reconstructedCents).toBe(700_000)
    expect(compared.realizedComparisons.find(item => item.date === '2026-11-01')?.reconstructedCents).toBe(700_000)
  })
})
