import { describe, expect, it } from 'vitest'
import type { FinanceData } from '../features/finance/financeTypes'
import {
  accountBalance, advanceRecurringDate, annualFinanceTotals, budgetPerformance, calculateFinanceMetrics, canRegisterEventualIncome, eventualIncomeTransactions,
  canonicalFinanceBudgetGroups, financeAvailableEvolution, financeDecision, financeFrequencyLabel, financeGoalProjections, financeLiquidityTimeline, financePeriodFlow, financeProjectionBreakdown, formatFinanceDate, goalProgress, monthKey, personalBudgetForDate, personalBudgetReservations, recurringAppliesToMonth, recurringExpectedDate, spentTodayCents,
} from './financeService'
import { financeLiquidityProjection } from './financeLiquidityProjection'

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
  liquidityPreference: { minimumOperatingBufferCents: 1_500_000 },
  liquiditySnapshots: [],
}

describe('financeService', () => {
  it('muestra ingresos eventuales cobrados y pendientes, pero no cancelados ni recurrentes', () => {
    const transactions = [
      { ...data.transactions[0], id: 'collected', status: 'completed' as const },
      { ...data.transactions[0], id: 'planned', status: 'planned' as const },
      { ...data.transactions[0], id: 'pending', status: 'pending' as const },
      { ...data.transactions[0], id: 'cancelled', status: 'cancelled' as const },
      { ...data.transactions[0], id: 'recurring', recurringTransactionId: 'salary' },
      { ...data.transactions[1], id: 'expense' },
    ]

    expect(eventualIncomeTransactions(transactions).map((item) => item.id)).toEqual(['collected', 'planned', 'pending'])
    expect(canRegisterEventualIncome(transactions[1])).toBe(true)
    expect(canRegisterEventualIncome(transactions[2])).toBe(true)
    expect(canRegisterEventualIncome(transactions[0])).toBe(false)
  })

  it('unifica duplicados personales y reserva sólo el remanente de cada quincena', () => {
    const september: FinanceData = {
      ...data,
      accounts: [{ ...data.accounts[0], initialBalanceCents: 1_000_000 }],
      categories: [
        { id: 'personal-a', name: 'Personal', type: 'expense', isDefault: false, isActive: true },
        { id: 'personal-b', name: 'Personal', type: 'expense', isDefault: false, isActive: true },
      ],
      transactions: [
        { ...data.transactions[1], id: 'q1-paid', categoryId: 'personal-a', amountCents: 100_000, transactionDate: '2026-09-04', status: 'completed' },
        { ...data.transactions[1], id: 'q1-planned', categoryId: 'personal-b', amountCents: 50_000, transactionDate: '2026-09-07', status: 'planned' },
        { ...data.transactions[1], id: 'q2-planned', categoryId: 'personal-a', amountCents: 50_000, transactionDate: '2026-09-18', status: 'planned' },
      ],
      budgets: [
        { id: 'old-q1', categoryId: 'personal-a', month: '2026-09-01', plannedAmountCents: 500_000, name: 'Gastos Personales', periodStart: '2026-09-01', periodEnd: '2026-09-15', createdAt: base, updatedAt: base },
        { id: 'new-q1', categoryId: 'personal-b', month: '2026-09-01', plannedAmountCents: 500_000, name: 'Gastos Personales', periodStart: '2026-09-01', periodEnd: '2026-09-15', createdAt: base, updatedAt: '2026-09-01T00:00:00.000Z' },
        { id: 'q2', categoryId: 'personal-a', month: '2026-09-01', plannedAmountCents: 300_000, name: 'Gastos Personales', periodStart: '2026-09-16', periodEnd: '2026-09-30', createdAt: base, updatedAt: base },
      ],
    }
    expect(canonicalFinanceBudgetGroups(september)).toHaveLength(2)
    expect(budgetPerformance(september, new Date(2026, 8, 1))).toHaveLength(2)
    expect(personalBudgetReservations(september, new Date(2026, 8, 1), new Date(2026, 8, 1))).toMatchObject([
      { budgetId: 'new-q1', date: '2026-09-01', amountCents: 350_000 },
      { budgetId: 'q2', date: '2026-09-16', amountCents: 250_000 },
    ])
    const projected = financeProjectionBreakdown(september, new Date(2026, 8, 1), new Date(2026, 8, 1))
    expect(projected.gastosPendientes).toBe(700_000)
    expect(projected.balanceProyectado).toBe(200_000)
  })

  it('acumula el remanente de Q1 con el presupuesto nuevo de Q2', () => {
    const fortnightData: FinanceData = {
      ...data,
      categories: [{ id: 'personal', name: 'Personal', type: 'expense', isDefault: false, isActive: true }],
      transactions: [
        { ...data.transactions[1], id: 'q1-use', categoryId: 'personal', amountCents: 300_000, transactionDate: '2026-09-08', status: 'completed' },
      ],
      budgets: [
        { id: 'q1', categoryId: 'personal', month: '2026-09-01', plannedAmountCents: 500_000, name: 'Gastos Personales', periodStart: '2026-09-01', periodEnd: '2026-09-15', createdAt: base, updatedAt: base },
        { id: 'q2', categoryId: 'personal', month: '2026-09-01', plannedAmountCents: 500_000, name: 'Gastos Personales', periodStart: '2026-09-16', periodEnd: '2026-09-30', carryOverEnabled: true, createdAt: base, updatedAt: base },
      ],
    }
    expect(personalBudgetReservations(fortnightData, new Date(2026, 8, 1), new Date(2026, 8, 1))).toMatchObject([
      { budgetId: 'q1', amountCents: 200_000 },
      { budgetId: 'q2', amountCents: 500_000 },
    ])
    expect(personalBudgetReservations(fortnightData, new Date(2026, 8, 1), new Date(2026, 8, 16))).toMatchObject([
      { budgetId: 'q2', amountCents: 700_000 },
    ])
  })

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
    const reference = new Date(2026, 6, 15)
    const before = calculateFinanceMetrics(data, new Date(2026, 6, 15), reference)
    const after = calculateFinanceMetrics({
      ...data,
      transactions: data.transactions.filter((transaction) => transaction.id !== 'e'),
    }, new Date(2026, 6, 15), reference)
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

  it('traza la liquidez desde el saldo real y coloca cada compromiso en su fecha', () => {
    const liquidityData: FinanceData = {
      ...data,
      accounts: [{ ...data.accounts[0], initialBalanceCents: 1_000 }],
      transactions: [
        { ...data.transactions[1], id: 'paid', amountCents: 200, transactionDate: '2026-07-01', status: 'completed', type: 'expense' },
        { ...data.transactions[1], id: 'bill', amountCents: 900, transactionDate: '2026-07-12', status: 'planned', type: 'expense', recurringTransactionId: undefined },
        { ...data.transactions[0], id: 'invoice', amountCents: 600, transactionDate: '2026-07-20', status: 'pending', type: 'income', recurringTransactionId: undefined },
      ],
      recurring: [{ id: 'phone', accountId: 'a', type: 'expense', amountCents: 250, description: 'Teléfono', frequency: 'monthly', startDate: '2026-07-01', nextOccurrence: '2026-07-15', isActive: true, createdAt: base, updatedAt: base }],
      recurringOccurrences: [{ id: 'phone-jul', recurringTransactionId: 'phone', period: '2026-07-01', expectedDate: '2026-07-15', amountCents: 250, status: 'pending', createdAt: base, updatedAt: base }],
    }
    const timeline = financeLiquidityTimeline(liquidityData, new Date(2026, 6, 1), new Date(2026, 6, 10))
    expect(timeline.startBalanceCents).toBe(800)
    expect(timeline.days.find((day) => day.date === '2026-07-12')?.balanceCents).toBe(-100)
    expect(timeline.days.find((day) => day.date === '2026-07-15')?.balanceCents).toBe(-350)
    expect(timeline.days.find((day) => day.date === '2026-07-20')?.balanceCents).toBe(250)
    expect(timeline.floorCents).toBe(-350)
    expect(timeline.uncommittedMarginCents).toBe(0)
  })

  it('mantiene el ahorro en patrimonio pero lo descuenta del disponible operativo', () => {
    const reserved: FinanceData = { ...data, accounts:[...data.accounts,{...data.accounts[0],id:'inactive',name:'Archivada',isActive:false}], transactions:[...data.transactions,{id:'saving',accountId:'a',categoryId:'food',type:'saving',amountCents:200_000,transactionDate:'2026-07-06',description:'Reserva',status:'completed',createdAt:base,updatedAt:base},{id:'inactive-saving',accountId:'inactive',categoryId:'food',type:'saving',amountCents:100_000,transactionDate:'2026-07-06',description:'Reserva archivada',status:'completed',createdAt:base,updatedAt:base}], savingsFundEntries:[{id:'f',fundId:'fund',amountCents:100_000,entryDate:'2026-07-06',createdAt:base}] }
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
    }, new Date(2026, 6, 15), new Date(2026, 6, 15))
    expect(projected).toEqual({
      saldoRealActual: 1_677_600,
      ingresosPendientes: 0,
      gastosPendientes: 0,
      ingresosRealizados: 1_677_600,
      gastosRealizados: 0,
      balanceProyectado: 1_677_600,
    })
  })

  it('no infla el pendiente con un recurrente que ya generó su movimiento pagado', () => {
    const rent = {
      id: 'rent', accountId: 'a', categoryId: 'food', type: 'expense' as const,
      amountCents: 1_228_700, description: 'Renta', frequency: 'monthly' as const,
      startDate: '2026-08-01', nextOccurrence: '2026-09-01', isActive: true, createdAt: base, updatedAt: base,
    }
    const projected = financeProjectionBreakdown({
      ...data,
      accounts: [{ ...data.accounts[0], initialBalanceCents: 2_000_000 }],
      transactions: [
        { ...data.transactions[1], id: 'rent-paid', type: 'expense' as const, amountCents: 1_228_700, transactionDate: '2026-08-01', description: 'Renta', status: 'completed' as const, recurringTransactionId: 'rent' },
        { ...data.transactions[1], id: 'pending', type: 'expense' as const, amountCents: 303_800, transactionDate: '2026-08-20', description: 'Pendiente real', status: 'pending' as const },
      ],
      recurring: [rent],
      recurringOccurrences: [{
        id: 'rent-paid', recurringTransactionId: 'rent', period: '2026-08-01', expectedDate: '2026-08-01', amountCents: 1_228_700,
        status: 'paid', transactionId: 'rent-paid', paidAt: base, createdAt: base, updatedAt: base,
      }],
    }, new Date(2026, 7, 15))
    expect(projected.gastosPendientes).toBe(303_800)
    expect(projected.gastosRealizados).toBe(1_228_700)
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
    }, new Date(2026, 6, 15), new Date(2026, 6, 15))
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

  it('homologa el cierre futuro con el arrastre mensual del radar', () => {
    const futureData: FinanceData = {
      ...data,
      accounts: [{ ...data.accounts[0], initialBalanceCents: 1_000_000 }],
      transactions: [
        { ...data.transactions[1], id: 'sep-expense', transactionDate: '2026-09-20', amountCents: 200_000, status: 'planned' },
        { ...data.transactions[0], id: 'sep-income', transactionDate: '2026-09-30', amountCents: 500_000, status: 'planned' },
        { ...data.transactions[1], id: 'oct-expense', transactionDate: '2026-10-01', amountCents: 430_000, status: 'planned' },
        { ...data.transactions[0], id: 'oct-income', transactionDate: '2026-10-30', amountCents: 600_000, status: 'planned' },
      ],
      budgets: [],
    }
    const referenceDate = new Date(2026, 8, 16)
    const october = new Date(2026, 9, 1)
    const breakdown = financeProjectionBreakdown(futureData, october, referenceDate)
    const metrics = calculateFinanceMetrics(futureData, october, referenceDate)
    const radarProjection = financeLiquidityProjection({
      data: futureData,
      month: october,
      currentAvailableBalanceCents: 1_000_000,
      minimumOperatingBufferCents: 0,
      referenceDate,
      includePersonalBudgetReservations: true,
    })

    expect(breakdown.balanceProyectado).toBe(1_470_000)
    expect(metrics.projectedBalanceCents).toBe(1_470_000)
    expect(radarProjection.openingBalanceCents).toBe(1_300_000)
    expect(radarProjection.closingBalanceCents).toBe(metrics.projectedBalanceCents)
  })

  it('separa patrimonio total de ahorro operativo proyectado', () => {
    const savingData: FinanceData = {
      ...data,
      accounts: [{ ...data.accounts[0], initialBalanceCents: 1_000_000 }],
      transactions: [],
      budgets: [],
      recurring: [{
        id: 'monthly-saving', accountId: 'a', categoryId: 'saving', type: 'saving',
        amountCents: 200_000, description: 'Ahorro mensual', frequency: 'monthly',
        startDate: '2026-07-01', nextOccurrence: '2026-07-15', isActive: true,
        createdAt: base, updatedAt: base,
      }],
      recurringOccurrences: [{
        id: 'saving-july', recurringTransactionId: 'monthly-saving', period: '2026-07-01',
        expectedDate: '2026-07-15', amountCents: 200_000, status: 'pending',
        createdAt: base, updatedAt: base,
      }],
    }
    const referenceDate = new Date(2026, 6, 10)
    const month = new Date(2026, 6, 1)
    const total = financeProjectionBreakdown(savingData, month, referenceDate)
    const operational = financeLiquidityProjection({
      data: savingData,
      month,
      currentAvailableBalanceCents: 1_000_000,
      minimumOperatingBufferCents: 0,
      referenceDate,
    })

    expect(total.balanceProyectado).toBe(1_000_000)
    expect(operational.closingBalanceCents).toBe(800_000)
  })

  it('muestra un cierre histórico realizado para meses pasados', () => {
    const historicalData: FinanceData = {
      ...data,
      accounts: [{ ...data.accounts[0], initialBalanceCents: 1_000_000 }],
      transactions: [
        { ...data.transactions[1], id: 'aug-paid', transactionDate: '2026-08-10', amountCents: 200_000, status: 'completed' },
        { ...data.transactions[1], id: 'aug-stale', transactionDate: '2026-08-20', amountCents: 900_000, status: 'planned' },
        { ...data.transactions[0], id: 'sep-paid', transactionDate: '2026-09-05', amountCents: 500_000, status: 'completed' },
      ],
      budgets: [],
    }
    const august = financeProjectionBreakdown(historicalData, new Date(2026, 7, 1), new Date(2026, 8, 16))

    expect(august.saldoRealActual).toBe(1_300_000)
    expect(august.gastosPendientes).toBe(900_000)
    expect(august.balanceProyectado).toBe(800_000)
  })
})
