import { describe, expect, it } from 'vitest'
import type { FinanceData } from '../features/finance/financeTypes'
import {
  accountBalance, advanceRecurringDate, annualFinanceTotals, budgetPerformance, calculateFinanceMetrics,
  financeDecision, financeFrequencyLabel, financeProjectionBreakdown, formatFinanceDate, goalProgress, monthKey, recurringAppliesToMonth, recurringExpectedDate,
} from './financeService'

const base = '2026-07-01T00:00:00.000Z'
const data: FinanceData = {
  accounts: [{ id: 'a', name: 'Débito', type: 'checking', currency: 'MXN', initialBalanceCents: 1_000_000, isActive: true, createdAt: base, updatedAt: base }],
  categories: [{ id: 'food', name: 'Comida', type: 'expense', isDefault: true, isActive: true }],
  transactions: [
    { id: 'i', accountId: 'a', type: 'income', amountCents: 2_500_000, transactionDate: '2026-07-02', description: 'Sueldo', status: 'completed', createdAt: base, updatedAt: base },
    { id: 'e', accountId: 'a', categoryId: 'food', type: 'expense', amountCents: 100_000, transactionDate: '2026-07-03', description: 'Comida', status: 'completed', createdAt: base, updatedAt: base },
    { id: 't', accountId: 'a', destinationAccountId: 'b', type: 'transfer', amountCents: 50_000, transactionDate: '2026-07-04', description: 'Mover', status: 'completed', createdAt: base, updatedAt: base },
  ],
  recurring: [],
  recurringOccurrences: [],
  budgets: [{ id: 'b', categoryId: 'food', month: '2026-07-01', plannedAmountCents: 400_000, createdAt: base, updatedAt: base }],
  goals: [{ id: 'g', name: 'Europa', targetAmountCents: 5_000_000, status: 'active', priority: 'high', createdAt: base, updatedAt: base }],
  contributions: [{ id: 'c', goalId: 'g', amountCents: 500_000, contributionDate: '2026-07-05', createdAt: base }],
}

describe('financeService', () => {
  it('calcula flujo sin contar transferencias como ingreso o gasto', () => {
    const metrics = calculateFinanceMetrics(data, new Date(2026, 6, 15))
    expect(metrics.monthlyIncomeCents).toBe(2_500_000)
    expect(metrics.monthlyExpensesCents).toBe(100_000)
    expect(accountBalance(data.accounts[0], data.transactions)).toBe(3_350_000)
  })

  it('calcula acumulados anuales sólo con movimientos completados', () => {
    const totals = annualFinanceTotals({
      ...data,
      transactions: [
        ...data.transactions,
        { id: 'planned', accountId: 'a', type: 'income', amountCents: 900_000, transactionDate: '2026-12-01', description: 'Pendiente', status: 'planned', createdAt: base, updatedAt: base },
        { id: 'other-year', accountId: 'a', type: 'expense', amountCents: 500_000, transactionDate: '2025-12-01', description: 'Anterior', status: 'completed', createdAt: base, updatedAt: base },
      ],
    }, 2026)
    expect(totals).toEqual({
      incomeCents: 2_500_000,
      expenseCents: 100_000,
      netCents: 2_400_000,
    })
  })

  it('calcula el uso del presupuesto con enteros', () => {
    expect(budgetPerformance(data, new Date(2026, 6, 15))[0]).toMatchObject({
      actualCents: 100_000, remainingCents: 300_000, usedPercentage: 25,
    })
  })

  it('deriva el progreso de meta desde aportaciones', () => {
    expect(goalProgress('g', data)).toEqual({
      savedCents: 500_000, remainingCents: 4_500_000, percentage: 10,
    })
  })

  it('genera una decisión diaria solo con presupuesto y datos reales', () => {
    expect(financeDecision(data, new Date(2026, 6, 15), new Date(2026, 6, 15))).toMatchObject({
      tone: 'positive',
    })
    expect(financeDecision({ ...data, accounts: [] }, new Date(2026, 6, 15))).toBeNull()
  })

  it('calcula la siguiente fecha recurrente sin duplicar el periodo actual', () => {
    const recurring = {
      id: 'r', accountId: 'a', categoryId: 'food', type: 'expense',
      amountCents: 100_000, description: 'Renta', frequency: 'monthly',
      startDate: '2026-07-05', nextOccurrence: '2026-07-05',
      isActive: true, createdAt: base, updatedAt: base,
    } as const
    expect(advanceRecurringDate(recurring)).toBe('2026-08-05')
    expect(recurringExpectedDate(recurring, new Date(2026, 7, 15))).toBe('2026-08-05')
    expect(recurringAppliesToMonth(recurring, new Date(2026, 7, 15))).toBe(true)
    expect(monthKey(new Date(2026, 7, 15))).toBe('2026-08-01')
  })

  it('respeta exactamente la próxima fecha editada y usa etiquetas legibles', () => {
    const recurring = {
      id: 'r', accountId: 'a', categoryId: 'income', type: 'income',
      amountCents: 10_000, description: 'Honorarios', frequency: 'biweekly',
      startDate: '2026-07-14', nextOccurrence: '2026-08-01',
      isActive: true, createdAt: base, updatedAt: base,
    } as const
    expect(recurringExpectedDate(recurring, new Date(2026, 7, 15))).toBe('2026-08-01')
    expect(financeFrequencyLabel[recurring.frequency]).toBe('Quincenal')
    expect(formatFinanceDate(recurring.nextOccurrence)).toBe('01 ago 2026')
  })

  it('desglosa saldo real y pendientes sin contar una ocurrencia pagada dos veces', () => {
    const recurring = {
      id: 'salary', accountId: 'a', categoryId: 'income', type: 'income',
      amountCents: 1_677_600, description: 'Sueldo', frequency: 'monthly',
      startDate: '2026-07-01', nextOccurrence: '2026-08-01',
      isActive: true, createdAt: base, updatedAt: base,
    } as const
    const projected = financeProjectionBreakdown({
      ...data, accounts: [{ ...data.accounts[0], initialBalanceCents: 0 }],
      transactions: [{
        id: 'occ', accountId: 'a', categoryId: 'income', type: 'income',
        amountCents: 1_677_600, transactionDate: '2026-07-01', description: 'Sueldo',
        status: 'completed', recurringTransactionId: 'salary', createdAt: base, updatedAt: base,
      }],
      recurring: [recurring],
      recurringOccurrences: [{
        id: 'occ', recurringTransactionId: 'salary', period: '2026-07-01',
        expectedDate: '2026-07-01', status: 'paid', transactionId: 'occ',
        paidAt: base, createdAt: base, updatedAt: base,
      }],
    }, new Date(2026, 6, 15))
    expect(projected).toEqual({
      saldoRealActual: 1_677_600,
      ingresosPendientes: 0,
      gastosPendientes: 0,
      ingresosRealizados: 1_677_600,
      gastosRealizados: 0,
      balanceProyectado: 1_677_600,
    })
  })

  it('vuelve a proyectar un recurrente al deshacer o faltar su movimiento', () => {
    const recurring = {
      id: 'salary', accountId: 'a', categoryId: 'income', type: 'income',
      amountCents: 1_677_600, description: 'Sueldo', frequency: 'monthly',
      startDate: '2026-07-01', nextOccurrence: '2026-07-01',
      isActive: true, createdAt: base, updatedAt: base,
    } as const
    const projected = financeProjectionBreakdown({
      ...data, accounts: [{ ...data.accounts[0], initialBalanceCents: 0 }],
      transactions: [], recurring: [recurring],
      recurringOccurrences: [{
        id: 'occ', recurringTransactionId: 'salary', period: '2026-07-01',
        expectedDate: '2026-07-01', amountCents: 1_677_600, status: 'pending',
        createdAt: base, updatedAt: base,
      }],
    }, new Date(2026, 6, 15))
    expect(projected.saldoRealActual).toBe(0)
    expect(projected.ingresosPendientes).toBe(1_677_600)
    expect(projected.balanceProyectado).toBe(1_677_600)
  })

  it('usa monto y fecha propios por periodo sin heredar cambios de otro mes', () => {
    const recurring = {
      id: 'salary', accountId: 'a', categoryId: 'income', type: 'income',
      amountCents: 700_000, description: 'Sueldo', frequency: 'monthly',
      startDate: '2026-07-01', nextOccurrence: '2026-07-01',
      isActive: true, createdAt: base, updatedAt: base,
    } as const
    const monthlyData = {
      ...data, accounts: [{ ...data.accounts[0], initialBalanceCents: 0 }],
      transactions: [], recurring: [recurring],
      recurringOccurrences: [
        { id: 'jul', recurringTransactionId: 'salary', period: '2026-07-01', expectedDate: '2026-07-30', amountCents: 720_000, status: 'pending', createdAt: base, updatedAt: base },
        { id: 'aug', recurringTransactionId: 'salary', period: '2026-08-01', expectedDate: '2026-08-14', amountCents: 750_000, status: 'pending', createdAt: base, updatedAt: base },
      ],
    } satisfies FinanceData
    expect(financeProjectionBreakdown(monthlyData, new Date(2026, 6, 15)).ingresosPendientes).toBe(720_000)
    expect(financeProjectionBreakdown(monthlyData, new Date(2026, 7, 15)).ingresosPendientes).toBe(750_000)
  })

  it('no proyecta un recurrente hasta configurar el periodo', () => {
    const recurring = {
      id: 'salary', accountId: 'a', categoryId: 'income', type: 'income',
      amountCents: 700_000, description: 'Sueldo', frequency: 'monthly',
      startDate: '2026-07-01', nextOccurrence: '2026-07-01',
      isActive: true, createdAt: base, updatedAt: base,
    } as const
    expect(financeProjectionBreakdown({
      ...data, accounts: [{ ...data.accounts[0], initialBalanceCents: 0 }],
      transactions: [], recurring: [recurring], recurringOccurrences: [],
    }, new Date(2026, 6, 15)).ingresosPendientes).toBe(0)
  })

  it('excluye recurrentes pausados, eliminados y fuera del periodo', () => {
    const template = {
      id: 'salary', accountId: 'a', categoryId: 'income', type: 'income',
      amountCents: 1_677_600, description: 'Sueldo', frequency: 'monthly',
      startDate: '2026-08-01', nextOccurrence: '2026-08-01',
      isActive: false, createdAt: base, updatedAt: base,
    } as const
    const baseData = { ...data, accounts: [{ ...data.accounts[0], initialBalanceCents: 0 }], transactions: [], recurringOccurrences: [] }
    expect(financeProjectionBreakdown({ ...baseData, recurring: [template] }, new Date(2026, 7, 15)).balanceProyectado).toBe(0)
    expect(financeProjectionBreakdown({ ...baseData, recurring: [] }, new Date(2026, 7, 15)).balanceProyectado).toBe(0)
    expect(financeProjectionBreakdown({ ...baseData, recurring: [{ ...template, isActive: true }] }, new Date(2026, 6, 15)).balanceProyectado).toBe(0)
  })
})
