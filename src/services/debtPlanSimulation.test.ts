import { describe, expect, it } from 'vitest'
import type { FinanceData } from '../features/finance/financeTypes'
import { defaultDebtPlanPreferences } from '../features/finance/debtTypes'
import { applyFinanceSimulation, type FinanceSimulationState } from './financeSimulation'
import { projectDebtPlan } from './debtPlanService'

const reference = new Date(2026, 9, 29)
const fixture = (): FinanceData => ({
  accounts: [{ id: 'bank', name: 'Banco', type: 'checking', currency: 'MXN', initialBalanceCents: 1_000_000, isActive: true, createdAt: '', updatedAt: '' }],
  categories: [], transactions: [], recurring: [], recurringOccurrences: [], budgets: [], goals: [], contributions: [], budgetClosures: [], savingsFundEntries: [], goalItems: [],
  liquidityPreference: { minimumOperatingBufferCents: 0 }, liquiditySnapshots: [],
  debtPlan: { entries: [], preferences: { ...defaultDebtPlanPreferences(), strategy: 'minimum' }, debts: [{ id: 'moto', name: 'Moto', creditor: 'Crédito', kind: 'purchase', status: 'active', balanceCents: 500_000, balanceDate: '2026-10-29', paymentCents: 85_000, frequency: 'weekly', nextPaymentDate: '2026-10-31', agreementStatus: 'none', priority: 0, createdAt: '', updatedAt: '' }] },
})

describe('Plan forecast under a simulation overlay', () => {
  it('closes a hypothetical discounted payoff, charges it once, and restores baseline when switched off', () => {
    const real = fixture(), before = structuredClone(real)
    const scenario: FinanceSimulationState = { version: 1, enabled: true, items: [{ id: 'payoff', kind: 'debt_payment', accountId: 'bank', debtId: 'moto', description: 'Liquidar moto', amountCents: 200_000, date: '2026-11-05', settles: true }] }
    const simulated = projectDebtPlan(applyFinanceSimulation(real, scenario, reference), { reference, strategy: 'minimum', months: 3 })
    expect(simulated.events.map(event => [event.date, event.amountCents, event.kind])).toEqual([
      ['2026-10-31', 85_000, 'payment'], ['2026-11-05', 200_000, 'settlement'],
    ])
    expect(simulated.remainingCents).toBe(0)
    expect(simulated.days.at(-1)?.balanceCents).toBe(715_000)
    const restored = applyFinanceSimulation(real, { ...scenario, enabled: false }, reference)
    expect(restored).toBe(real)
    expect(projectDebtPlan(restored, { reference, strategy: 'minimum', months: 3 }).totalPaidCents).toBe(500_000)
    expect(real).toEqual(before)
  })
  it('uses the explicit capital reduction separately from a planned payment with interest', () => {
    const real = fixture()
    real.transactions.push({ id: 'with-interest', accountId: 'bank', debtId: 'moto', type: 'debt_payment', description: 'Pago con intereses', amountCents: 100_000, debtPrincipalCents: 60_000, status: 'planned', transactionDate: '2026-10-31', createdAt: '', updatedAt: '' })
    const plan = projectDebtPlan(real, { reference, strategy: 'minimum', months: 3 })
    expect(plan.events[0]).toMatchObject({ amountCents: 100_000, remainingCents: 440_000 })
    expect(plan.totalPaidCents).toBe(540_000)
    expect(plan.remainingCents).toBe(0)
  })
})
