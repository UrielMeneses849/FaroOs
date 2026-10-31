import { describe, expect, it } from 'vitest'
import type { FinanceData } from '../features/finance/financeTypes'
import { habitualDebtPayment, habitualDebtPaymentId } from './debtPayment'
import { debtRemainingCents } from './debtSchedule'
import { defaultDebtPlanPreferences } from '../features/finance/debtTypes'
const fixture = (): FinanceData => ({ accounts: [
  { id: 'other', name: 'Otra', type: 'checking', initialBalanceCents: 10_000_000, currency: 'MXN', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'bank', name: 'Nu', type: 'checking', initialBalanceCents: 10_000_000, currency: 'MXN', isActive: true, createdAt: '', updatedAt: '' }],
  categories: [{ id: 'plan', name: 'Plan', type: 'expense', isActive: true, isDefault: false }], transactions: [], recurring: [], recurringOccurrences: [], budgets: [], goals: [], contributions: [], budgetClosures: [], savingsFundEntries: [], goalItems: [], liquiditySnapshots: [], liquidityPreference: { minimumOperatingBufferCents: 200_000 },
  debtPlan: { debts: [{ id: 'moto', name: 'Moto', creditor: 'Vento', kind: 'loan', status: 'active', balanceCents: 2_536_800, balanceDate: '2026-10-16', paymentCents: 90_600, frequency: 'weekly', nextPaymentDate: '2026-10-17', agreementStatus: 'none', priority: 0, createdAt: '', updatedAt: '' }], entries: [], preferences: defaultDebtPlanPreferences() } })
describe('one-action habitual debt tracking', () => {
  it('shares an idempotent installment identity across devices and keeps other dates distinct', async () => {
    const id = await habitualDebtPaymentId('moto', '2026-10-31')
    expect(await habitualDebtPaymentId('moto', '2026-10-31')).toBe(id)
    expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
    expect(await habitualDebtPaymentId('moto', '2026-11-07')).not.toBe(id)
    expect(await habitualDebtPaymentId('other', '2026-10-31')).not.toBe(id)
  })
  it('uses the last payment account, funds Plan automatically and reduces debt exactly once', () => {
    const data = fixture(), debt = data.debtPlan!.debts[0]
    data.transactions.push({ id: 'last', accountId: 'bank', debtId: 'moto', type: 'expense', amountCents: 90_600, transactionDate: '2026-10-24', status: 'completed', description: 'Pago moto', createdAt: '', updatedAt: '' })
    data.debtPlan!.entries.push({ id: 'reserved', accountId: 'bank', amountCents: 30_000, entryDate: '2026-10-30', createdAt: '' })
    const before = structuredClone(data)
    const input = habitualDebtPayment(debt, data, 'payment-id', { date: '2026-10-31', amountCents: 90_600 }, new Date(2026,9,31))
    expect(input).toMatchObject({ id: 'payment-id', accountId: 'bank', amountCents: 90_600, planAmountCents: 30_000, debtId: 'moto', transactionDate: '2026-10-31', status: 'completed' })
    expect(data).toEqual(before)
    data.transactions.push({ ...input, createdAt: '', updatedAt: '' })
    expect(debtRemainingCents(debt, data)).toBe(2_355_600)
    data.transactions.at(-1)!.status = 'cancelled'
    expect(debtRemainingCents(debt, data)).toBe(2_446_200)
  })
  it('caps the last installment and rejects recording a settled debt', () => {
    const data=fixture(), debt=data.debtPlan!.debts[0]
    debt.balanceCents=20_000
    expect(habitualDebtPayment(debt,data,'last',{date:'2026-10-31',amountCents:90_600}).amountCents).toBe(20_000)
    debt.balanceCents=0
    expect(()=>habitualDebtPayment(debt,data,'again',{date:'2026-10-31',amountCents:90_600})).toThrow('liquidada')
  })
})
