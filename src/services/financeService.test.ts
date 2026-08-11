import { describe, expect, it } from 'vitest'
import type { FinanceData } from '../features/finance/financeTypes'
import {
  accountBalance, advanceRecurringDate, annualFinanceTotals, budgetPerformance, calculateFinanceMetrics,
  financeAvailableEvolution, financeDecision, financeFrequencyLabel, financeGoalProjections, financePeriodFlow, financeProjectionBreakdown, formatFinanceDate, goalProgress, monthKey, personalBudgetForDate, recurringAppliesToMonth, recurringExpectedDate, spentTodayCents,
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
  budgetClosures: [], savingsFundEntries: [], goalItems: [],
}

describe('financeService', () => {
  it('separa el flujo del periodo de la evolución del disponible', () => {
    const periodData = {
      ...data,
      accounts: [
        { ...data.accounts[0], initialBalanceCents: 100_000 },
        { ...data.accounts[0], id: 'b', name: 'Ahorro', initialBalanceCents: 0 },
      ],
      transactions: [
        { ...data.transactions[0], id: 'income', type: 'income' as const, status: 'completed' as const, amountCents: 50_000, transactionDate: '2026-07-02' },
        { ...data.transactions[0], id: 'expense', type: 'expense' as const, status: 'completed' as const, amountCents: 20_000, transactionDate: '2026-07-03' },
        { ...data.transactions[0], id: 'saving', type: 'saving' as const, status: 'completed' as const, amountCents: 10_000, transactionDate: '2026-07-04' },
        { ...data.transactions[0], id: 'transfer', type: 'transfer' as const, status: 'completed' as const, amountCents: 99_000, transactionDate: '2026-07-05', destinationAccountId: 'b' },
      ],
    }
    expect(financePeriodFlow(periodData, new Date(2026, 6, 15))).toEqual({ incomeCents: 50_000, expenseCents: 20_000, savingCents: 10_000, netCents: 20_000 })
    expect(financeAvailableEvolution(periodData, new Date(2026, 6, 15))).toMatchObject({ initialCents: 100_000, finalCents: 120_000 })
  })
  it('calcula flujo sin contar transferencias como ingreso o gasto', () => {
    const metrics = calculateFinanceMetrics(data, new Date(2026, 6, 15))
    expect(metrics.monthlyIncomeCents).toBe(2_500_000)
    expect(metrics.monthlyExpensesCents).toBe(100_000)
    expect(accountBalance(data.accounts[0], data.transactions)).toBe(3_350_000)
  })

  it('recalcula los balances al retirar un movimiento eliminado', () => {
    const before = calculateFinanceMetrics(data, new Date(2026, 6, 15))
    const after = calculateFinanceMetrics({
      ...data,
      transactions: data.transactions.filter((transaction) => transaction.id !== 'e'),
    }, new Date(2026, 6, 15))
    expect(before.monthlyExpensesCents).toBe(100_000)
    expect(after.monthlyExpensesCents).toBe(0)
    expect(after.actualBalanceCents).toBe(before.actualBalanceCents + 100_000)
    expect(after.projectedBalanceCents).toBe(before.projectedBalanceCents + 100_000)
  })

  it('calcula Gastado hoy sólo con gastos y pagos de deuda completados locales', () => {
    const transactions = [
      { ...data.transactions[1], id: 'expense', transactionDate: '2026-08-08', amountCents: 1_200, type: 'expense' as const, status: 'completed' as const },
      { ...data.transactions[1], id: 'debt', transactionDate: '2026-08-08', amountCents: 800, type: 'debt_payment' as const, status: 'completed' as const },
      { ...data.transactions[0], id: 'income', transactionDate: '2026-08-08', amountCents: 5_000, type: 'income' as const, status: 'completed' as const },
      { ...data.transactions[2], id: 'transfer', transactionDate: '2026-08-08', amountCents: 900, type: 'transfer' as const, status: 'completed' as const },
      { ...data.transactions[1], id: 'saving', transactionDate: '2026-08-08', amountCents: 600, type: 'saving' as const, status: 'completed' as const },
      { ...data.transactions[1], id: 'planned', transactionDate: '2026-08-08', amountCents: 400, type: 'expense' as const, status: 'planned' as const },
      { ...data.transactions[1], id: 'cancelled', transactionDate: '2026-08-08', amountCents: 300, type: 'expense' as const, status: 'cancelled' as const },
      { ...data.transactions[1], id: 'yesterday', transactionDate: '2026-08-07', amountCents: 700, type: 'expense' as const, status: 'completed' as const },
    ]
    expect(spentTodayCents(transactions, '2026-08-08')).toBe(2_000)
  })

  it('mantiene el ahorro en patrimonio pero lo descuenta del disponible operativo', () => {
    const reserved: FinanceData = { ...data, transactions:[...data.transactions,{id:'saving',accountId:'a',categoryId:'food',type:'saving',amountCents:200_000,transactionDate:'2026-07-06',description:'Reserva',status:'completed',createdAt:base,updatedAt:base}], savingsFundEntries:[{id:'f',fundId:'fund',amountCents:100_000,entryDate:'2026-07-06',createdAt:base}] }
    expect(accountBalance(reserved.accounts[0],reserved.transactions)).toBe(3_350_000)
    expect(calculateFinanceMetrics(reserved,new Date(2026,6,15)).availableBalanceCents).toBe(3_150_000)
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

  it('vincula Personal únicamente al presupuesto que contiene la fecha del gasto', () => {
    const budgets = [
      { id: 'first', name: 'Gastos Personales', periodStart: '2026-08-01', periodEnd: '2026-08-15' },
      { id: 'second', name: 'Gastos Personales', periodStart: '2026-08-16', periodEnd: '2026-08-31' },
    ]
    expect(personalBudgetForDate(budgets, '2026-08-14')?.id).toBe('first')
    expect(personalBudgetForDate(budgets, '2026-08-20')?.id).toBe('second')
    expect(personalBudgetForDate(budgets, '2026-09-01')).toBeUndefined()
  })

  it('deriva el progreso de meta desde aportaciones', () => {
    expect(goalProgress('g', data)).toEqual({
      savedCents: 500_000, remainingCents: 4_500_000, percentage: 10,
    })
  })

  it('calcula la aportación mensual necesaria y el ritmo reciente por meta', () => {
    const projections = financeGoalProjections([{
      ...data.goals[0], targetDate: '2026-12-31', targetAmountCents: 1_100_000,
    }], [{ ...data.contributions[0], amountCents: 500_000 }], new Date(2026, 6, 31))
    expect(projections[0]).toMatchObject({
      savedCents: 500_000,
      remainingCents: 600_000,
      requiredMonthlyCents: 100_000,
      averageMonthlyCents: 166_667,
      status: 'on_track',
    })
  })

  it('pide una fecha para proyectar una meta sin vencimiento', () => {
    expect(financeGoalProjections(data.goals, data.contributions, new Date(2026, 6, 31))[0]).toMatchObject({
      requiredMonthlyCents: 0,
      status: 'no_date',
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
