import { addMonths, endOfMonth, format, isAfter, isBefore, parseISO, startOfMonth } from 'date-fns'
import { es } from 'date-fns/locale'
import type {
  FinanceAccount,
  FinanceBudget,
  FinanceCategory,
  FinanceData,
  FinanceMetrics,
  FinanceRecurringTransaction,
  FinanceGoal,
  FinanceGoalContribution,
  FinanceTransaction,
} from '../features/finance/financeTypes'

export const formatMxn = (cents: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(cents / 100)

export const financeFrequencyLabel = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
  bimonthly: 'Bimestral',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
  yearly: 'Anual',
} as const

export const formatFinanceDate = (value: string) =>
  format(parseISO(value), 'dd MMM yyyy', { locale: es })

export const monthKey = (date: Date) => format(startOfMonth(date), 'yyyy-MM-dd')
const inMonth = (date: string, month: Date) => date.startsWith(format(month, 'yyyy-MM'))
const completed = (transaction: FinanceTransaction) => transaction.status === 'completed'

export function transactionImpact(transaction: FinanceTransaction) {
  if (!completed(transaction)) return 0
  if (transaction.type === 'income' || transaction.type === 'refund') return transaction.amountCents
  // Saving stays in the patrimony, but is removed from operational availability below.
  if (transaction.type === 'expense' || transaction.type === 'debt_payment') return -transaction.amountCents
  return 0
}

export function accountBalance(account: FinanceAccount, transactions: FinanceTransaction[]) {
  return transactions.reduce((balance, transaction) => {
    if (!completed(transaction)) return balance
    if (transaction.type === 'transfer') {
      if (transaction.accountId === account.id) return balance - transaction.amountCents
      if (transaction.destinationAccountId === account.id) return balance + transaction.amountCents
      return balance
    }
    if (transaction.accountId !== account.id) return balance
    return balance + transactionImpact(transaction)
  }, account.initialBalanceCents)
}

function nextOccurrence(item: FinanceRecurringTransaction, date: Date) {
  const days = item.frequency === 'weekly' ? 7 : item.frequency === 'biweekly' ? 14 : null
  if (days) {
    const result = new Date(date)
    result.setDate(result.getDate() + days)
    return result
  }
  const months = item.frequency === 'monthly' ? 1 : item.frequency === 'quarterly' ? 3 : 12
  return addMonths(date, months)
}

export function advanceRecurringDate(item: FinanceRecurringTransaction) {
  return format(nextOccurrence(item, parseISO(item.nextOccurrence)), 'yyyy-MM-dd')
}

export function recurringAppliesToMonth(item: FinanceRecurringTransaction, month: Date) {
  const start = startOfMonth(month)
  const end = endOfMonth(month)
  return !isAfter(parseISO(item.startDate), end)
    && (!item.endDate || !isBefore(parseISO(item.endDate), start))
}

export function recurringExpectedDate(item: FinanceRecurringTransaction, month: Date) {
  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(month)
  let expected = parseISO(item.nextOccurrence)
  let guard = 0
  while (isBefore(expected, monthStart) && guard < 60) {
    expected = nextOccurrence(item, expected)
    guard += 1
  }
  if (!isAfter(expected, monthEnd)) return format(expected, 'yyyy-MM-dd')
  return item.nextOccurrence
}

export function recurringOccurrences(item: FinanceRecurringTransaction, month: Date) {
  if (!item.isActive) return 0
  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(month)
  let occurrence = parseISO(item.nextOccurrence)
  const endDate = item.endDate ? parseISO(item.endDate) : null
  let count = 0
  let guard = 0
  while (!isAfter(occurrence, monthEnd) && guard < 60) {
    if (!isBefore(occurrence, monthStart) && (!endDate || !isAfter(occurrence, endDate))) count += 1
    occurrence = nextOccurrence(item, occurrence)
    guard += 1
  }
  return count
}

export interface FinanceProjectionBreakdown {
  saldoRealActual: number
  ingresosPendientes: number
  gastosPendientes: number
  ingresosRealizados: number
  gastosRealizados: number
  balanceProyectado: number
}

export function financeProjectionBreakdown(data: FinanceData, month: Date): FinanceProjectionBreakdown {
  const monthly = data.transactions.filter((item) => inMonth(item.transactionDate, month))
  const ingresosRealizados = monthly.filter((item) =>
    completed(item) && (item.type === 'income' || item.type === 'refund'))
    .reduce((sum, item) => sum + item.amountCents, 0)
  const gastosRealizados = monthly.filter((item) =>
    completed(item) && (item.type === 'expense' || item.type === 'saving' || item.type === 'debt_payment'))
    .reduce((sum, item) => sum + item.amountCents, 0)
  const saldoRealActual = data.accounts
    .reduce((sum, account) => sum + accountBalance(account, data.transactions), 0)
  const pendingEventual = monthly.filter((item) =>
    !item.recurringTransactionId && (item.status === 'planned' || item.status === 'pending'))
  let ingresosPendientes = pendingEventual.filter((item) => item.type === 'income' || item.type === 'refund')
    .reduce((sum, item) => sum + item.amountCents, 0)
  let gastosPendientes = pendingEventual.filter((item) =>
    item.type === 'expense' || item.type === 'debt_payment')
    .reduce((sum, item) => sum + item.amountCents, 0)
  const period = monthKey(month)
  for (const item of data.recurring) {
    if (!item.isActive || !recurringAppliesToMonth(item, month)) continue
    const occurrence = data.recurringOccurrences.find((candidate) =>
      candidate.recurringTransactionId === item.id && candidate.period === period)
    const generatedMovementExists = Boolean(occurrence?.transactionId && data.transactions.some((transaction) =>
      transaction.id === occurrence.transactionId && transaction.status === 'completed'))
    if (occurrence?.status === 'skipped' || (occurrence?.status === 'paid' && generatedMovementExists)) continue
    if (!occurrence?.amountCents || !inMonth(occurrence.expectedDate, month)) continue
    if (item.type === 'income' || item.type === 'refund') ingresosPendientes += occurrence.amountCents
    else if (item.type !== 'transfer') gastosPendientes += occurrence.amountCents
  }
  return {
    saldoRealActual,
    ingresosPendientes,
    gastosPendientes,
    ingresosRealizados,
    gastosRealizados,
    balanceProyectado: saldoRealActual + ingresosPendientes - gastosPendientes,
  }
}

export function calculateFinanceMetrics(data: FinanceData, month: Date): FinanceMetrics {
  const monthly = data.transactions.filter((item) => inMonth(item.transactionDate, month))
  const projection = financeProjectionBreakdown(data, month)
  const monthlyIncomeCents = monthly.filter((item) => completed(item) && item.type === 'income')
    .reduce((sum, item) => sum + item.amountCents, 0)
  const refunds = monthly.filter((item) => completed(item) && item.type === 'refund')
    .reduce((sum, item) => sum + item.amountCents, 0)
  const monthlyExpensesCents = Math.max(0, monthly
    .filter((item) => completed(item) && (item.type === 'expense' || item.type === 'debt_payment'))
    .reduce((sum, item) => sum + item.amountCents, 0) - refunds)
  const monthlySavingsCents = monthly.filter((item) => completed(item) && item.type === 'saving')
    .reduce((sum, item) => sum + item.amountCents, 0)
  const totalMoneyCents = projection.saldoRealActual
  const physicalAvailable = data.accounts.filter((account) => account.isActive)
    .reduce((sum, account) => sum + accountBalance(account, data.transactions), 0)
  const reservedSavings = data.transactions.filter((item) => completed(item) && item.type === 'saving')
    .reduce((sum, item) => sum + item.amountCents, 0)
  const availableBalanceCents = physicalAvailable - reservedSavings
  const plannedBudget = data.budgets.filter((item) => item.month === monthKey(month))
    .reduce((sum, item) => sum + item.plannedAmountCents, 0)
  return {
    monthlyIncomeCents,
    monthlyExpensesCents,
    monthlySavingsCents,
    availableBalanceCents,
    totalMoneyCents,
    projectedBalanceCents: projection.balanceProyectado,
    actualBalanceCents: totalMoneyCents,
    budgetVarianceCents: plannedBudget - monthlyExpensesCents,
    savingsRate: monthlyIncomeCents ? monthlySavingsCents / monthlyIncomeCents * 100 : 0,
  }
}

export function financePeriodFlow(data: FinanceData, month: Date) {
  const metrics = calculateFinanceMetrics(data, month)
  return {
    incomeCents: metrics.monthlyIncomeCents,
    expenseCents: metrics.monthlyExpensesCents,
    savingCents: metrics.monthlySavingsCents,
    netCents: metrics.monthlyIncomeCents - metrics.monthlyExpensesCents - metrics.monthlySavingsCents,
  }
}

export function financeAvailableEvolution(data: FinanceData, month: Date) {
  const flow = financePeriodFlow(data, month)
  const finalCents = calculateFinanceMetrics(data, month).availableBalanceCents
  return {
    initialCents: finalCents - flow.incomeCents + flow.expenseCents + flow.savingCents,
    ...flow,
    finalCents,
  }
}

export function annualFinanceTotals(data: FinanceData, year: number) {
  const annual = data.transactions.filter((item) =>
    item.status === 'completed' && item.transactionDate.startsWith(`${year}-`))
  const incomeCents = annual
    .filter((item) => item.type === 'income' || item.type === 'refund')
    .reduce((sum, item) => sum + item.amountCents, 0)
  const expenseCents = annual
    .filter((item) => item.type === 'expense' || item.type === 'debt_payment')
    .reduce((sum, item) => sum + item.amountCents, 0)
  return {
    incomeCents,
    expenseCents,
    netCents: incomeCents - expenseCents,
  }
}

export interface BudgetPerformance extends FinanceBudget {
  category?: FinanceCategory
  actualCents: number
  remainingCents: number
  usedPercentage: number
}

export function personalBudgetForDate(
  budgets: Array<Pick<FinanceBudget, 'id' | 'name' | 'periodStart' | 'periodEnd'>>,
  date: string,
) {
  return budgets
    .filter((budget) => (budget.name ?? 'Gastos Personales') === 'Gastos Personales'
      && Boolean(budget.periodStart && budget.periodEnd)
      && budget.periodStart! <= date && budget.periodEnd! >= date)
    .sort((a, b) => (b.periodStart ?? '').localeCompare(a.periodStart ?? ''))[0]
}

export function budgetPerformance(data: FinanceData, month: Date): BudgetPerformance[] {
  return data.budgets.filter((budget) => (budget.periodStart??budget.month) <= format(month,'yyyy-MM-dd') && (budget.periodEnd??format(endOfMonth(parseISO(budget.month)),'yyyy-MM-dd')) >= format(month,'yyyy-MM-dd')).map((budget) => {
    const linkedCategory = data.categories.find((item) => item.id === budget.categoryId)
    const actualCents = data.transactions.filter((item) =>
      (item.budgetId === budget.id || (!item.budgetId && item.categoryId === budget.categoryId && (linkedCategory?.name === 'Personal' || !budget.periodStart)))
      && item.transactionDate >= (budget.periodStart??budget.month) && item.transactionDate <= (budget.periodEnd??format(endOfMonth(parseISO(budget.month)),'yyyy-MM-dd'))
      && completed(item) && (item.type === 'expense' || item.type === 'debt_payment'))
      .reduce((sum, item) => sum + item.amountCents, 0)
    return {
      ...budget,
      category: linkedCategory,
      actualCents,
      remainingCents: budget.plannedAmountCents - actualCents,
      usedPercentage: budget.plannedAmountCents ? actualCents / budget.plannedAmountCents * 100 : 0,
    }
  })
}

export function goalProgress(goalId: string, data: FinanceData) {
  const goal = data.goals.find((item) => item.id === goalId)
  if (!goal) return { savedCents: 0, remainingCents: 0, percentage: 0 }
  const targetCents = goalTargetCents(goalId,data)
  const savedCents = data.contributions.filter((item) => item.goalId === goalId)
    .reduce((sum, item) => sum + item.amountCents, 0)
  return {
    savedCents,
    remainingCents: Math.max(0, targetCents - savedCents),
    percentage: targetCents ? Math.min(100, savedCents / targetCents * 100) : 0,
  }
}

export function goalTargetCents(goalId:string,data:FinanceData){const active=data.goalItems.filter(item=>item.goalId===goalId&&item.status!=='discarded');return active.length?active.reduce((sum,item)=>sum+item.priceCents,0):data.goals.find(item=>item.id===goalId)?.targetAmountCents??0}
export function goalSpentCents(goalId:string,data:FinanceData){return data.goalItems.filter(item=>item.goalId===goalId&&item.status==='purchased').reduce((sum,item)=>sum+item.priceCents,0)}
export function goalAvailableCents(goalId:string,data:FinanceData){const contributed=data.contributions.filter(item=>item.goalId===goalId).reduce((sum,item)=>sum+item.amountCents,0);return Math.max(0,contributed-goalSpentCents(goalId,data))}
export function savingsFundMetrics(data:FinanceData,reference=new Date()){const balanceCents=data.savingsFundEntries.reduce((sum,item)=>sum+item.amountCents,0);const month=format(reference,'yyyy-MM');const year=format(reference,'yyyy');return{balanceCents,monthCents:data.savingsFundEntries.filter(item=>item.entryDate.startsWith(month)&&item.amountCents>0).reduce((s,i)=>s+i.amountCents,0),yearCents:data.savingsFundEntries.filter(item=>item.entryDate.startsWith(year)&&item.amountCents>0).reduce((s,i)=>s+i.amountCents,0),lastEntry:data.savingsFundEntries[0]}}

export type FinanceGoalProjectionStatus = 'on_track' | 'attention' | 'behind' | 'no_date' | 'completed'

export interface FinanceGoalProjection {
  goal: FinanceGoal
  savedCents: number
  remainingCents: number
  progressPercentage: number
  requiredMonthlyCents: number
  averageMonthlyCents: number
  targetLabel: string
  status: FinanceGoalProjectionStatus
  statusLabel: string
  insight: string
}

export function financeGoalProjections(goals: FinanceGoal[], contributions: FinanceGoalContribution[], referenceDate: Date): FinanceGoalProjection[] {
  const currentMonth = startOfMonth(referenceDate)
  const recentStart = addMonths(currentMonth, -2)
  return goals.filter((goal) => goal.status === 'active').map<FinanceGoalProjection>((goal) => {
    const goalContributions = contributions.filter((item) => item.goalId === goal.id)
    const savedCents = goalContributions.reduce((sum, item) => sum + item.amountCents, 0)
    const remainingCents = Math.max(0, goal.targetAmountCents - savedCents)
    const progressPercentage = goal.targetAmountCents ? Math.min(100, savedCents / goal.targetAmountCents * 100) : 0
    const recentTotal = goalContributions.filter((item) => {
      const date = parseISO(item.contributionDate)
      return !isBefore(date, recentStart) && !isAfter(date, endOfMonth(currentMonth))
    }).reduce((sum, item) => sum + item.amountCents, 0)
    const averageMonthlyCents = Math.round(recentTotal / 3)
    if (remainingCents === 0) return { goal, savedCents, remainingCents, progressPercentage, requiredMonthlyCents: 0, averageMonthlyCents, targetLabel: 'Meta cubierta', status: 'completed', statusLabel: 'Cumplida', insight: 'Ya reuniste el monto objetivo.' }
    if (!goal.targetDate) return { goal, savedCents, remainingCents, progressPercentage, requiredMonthlyCents: 0, averageMonthlyCents, targetLabel: 'Sin fecha objetivo', status: 'no_date', statusLabel: 'Define fecha', insight: 'Agrega una fecha objetivo para calcular cuánto aportar cada mes.' }
    const targetMonth = startOfMonth(parseISO(goal.targetDate))
    const monthDistance = (targetMonth.getFullYear() - currentMonth.getFullYear()) * 12 + targetMonth.getMonth() - currentMonth.getMonth()
    const monthsRemaining = Math.max(1, monthDistance + 1)
    const requiredMonthlyCents = Math.ceil(remainingCents / monthsRemaining)
    const overdue = isBefore(parseISO(goal.targetDate), referenceDate)
    const status: FinanceGoalProjectionStatus = overdue || averageMonthlyCents < requiredMonthlyCents * .75 ? 'behind' : averageMonthlyCents < requiredMonthlyCents ? 'attention' : 'on_track'
    const statusLabel = overdue ? 'Fecha vencida' : status === 'on_track' ? 'En ruta' : status === 'attention' ? 'Cerca del ritmo' : 'Requiere ajuste'
    const gap = Math.max(0, requiredMonthlyCents - averageMonthlyCents)
    const insight = overdue ? `La fecha objetivo ya pasó; actualízala o aporta ${formatMxn(remainingCents)} para cerrar la meta.` : status === 'on_track' ? `Tu ritmo reciente cubre la aportación mensual necesaria durante ${monthsRemaining} ${monthsRemaining === 1 ? 'mes' : 'meses'}.` : `Para recuperar el ritmo, agrega aproximadamente ${formatMxn(gap)} más al mes.`
    return { goal, savedCents, remainingCents, progressPercentage, requiredMonthlyCents, averageMonthlyCents, targetLabel: `Objetivo ${formatFinanceDate(goal.targetDate)} · ${monthsRemaining} ${monthsRemaining === 1 ? 'mes' : 'meses'}`, status, statusLabel, insight }
  }).sort((a, b) => b.requiredMonthlyCents - a.requiredMonthlyCents)
}

export function financeSummary(data: FinanceData, month: Date) {
  const monthly = data.transactions.filter((item) => inMonth(item.transactionDate, month))
  const actual = (types: FinanceTransaction['type'][]) => monthly
    .filter((item) => completed(item) && types.includes(item.type))
    .reduce((sum, item) => sum + item.amountCents, 0)
  const planned = (types: FinanceTransaction['type'][]) => monthly
    .filter((item) => item.status !== 'cancelled' && types.includes(item.type))
    .reduce((sum, item) => sum + item.amountCents, 0)
  const recurringExpenseIds = new Set(data.recurring.filter((item) => item.type === 'expense').map((item) => item.id))
  const fixedActual = monthly.filter((item) => completed(item) && item.recurringTransactionId && recurringExpenseIds.has(item.recurringTransactionId))
    .reduce((sum, item) => sum + item.amountCents, 0)
  const variableActual = actual(['expense', 'debt_payment']) - fixedActual
  const metrics = calculateFinanceMetrics(data, month)
  const period = monthKey(month)
  const fixedPlanned = data.recurringOccurrences
    .filter((occurrence) => occurrence.period === period && occurrence.status !== 'skipped')
    .filter((occurrence) => recurringExpenseIds.has(occurrence.recurringTransactionId))
    .reduce((sum, occurrence) => sum + (occurrence.amountCents ?? 0), 0)
  return [
    { label: 'Ingresos', planned: planned(['income']), actual: actual(['income']) },
    { label: 'Gastos fijos', planned: fixedPlanned, actual: fixedActual },
    { label: 'Gastos variables', planned: data.budgets.filter((item) => item.month === monthKey(month)).reduce((sum, item) => sum + item.plannedAmountCents, 0), actual: variableActual },
    { label: 'Ahorro', planned: planned(['saving']), actual: actual(['saving']) },
    { label: 'Balance', planned: metrics.projectedBalanceCents, actual: metrics.actualBalanceCents },
  ].map((row) => ({ ...row, difference: row.actual - row.planned }))
}

export interface FinanceDecision {
  title: string
  detail: string
  tone: 'positive' | 'neutral' | 'warning'
}

export function financeDecision(data: FinanceData, month: Date, today = new Date()): FinanceDecision | null {
  if (!data.accounts.length) return null
  const metrics = calculateFinanceMetrics(data, month)
  const selectedMonth = format(month, 'yyyy-MM')
  const currentMonth = format(today, 'yyyy-MM')
  const performances = budgetPerformance(data, month)
  const remainingBudgetCents = performances.reduce((sum, item) => sum + item.remainingCents, 0)

  if (selectedMonth === currentMonth && performances.length) {
    const remainingDays = Math.max(1, endOfMonth(today).getDate() - today.getDate() + 1)
    const spendableCents = Math.max(0, Math.min(metrics.availableBalanceCents, remainingBudgetCents))
    if (spendableCents <= 0) {
      return {
        title: 'Tu presupuesto mensual ya no tiene margen disponible.',
        detail: 'Revisa las categorías excedidas antes del próximo gasto.',
        tone: 'warning',
      }
    }
    return {
      title: `Te quedan ${formatMxn(spendableCents)} disponibles este mes.`,
      detail: `Equivale a ${formatMxn(Math.floor(spendableCents / remainingDays))} por día durante los próximos ${remainingDays} días.`,
      tone: 'positive',
    }
  }

  const projectionGap = metrics.projectedBalanceCents - metrics.actualBalanceCents
  if (projectionGap !== 0) {
    return {
      title: `Tu proyección está ${formatMxn(Math.abs(projectionGap))} ${projectionGap > 0 ? 'por encima' : 'por debajo'} del balance real.`,
      detail: 'La diferencia considera movimientos planeados, pendientes y recurrentes del periodo.',
      tone: projectionGap >= 0 ? 'neutral' : 'warning',
    }
  }
  return null
}
