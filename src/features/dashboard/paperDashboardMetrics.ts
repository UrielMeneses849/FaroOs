import { addMonths, format, setDate, startOfMonth } from 'date-fns'
import { canonicalFinanceBudgetGroups, calculateFinanceMetrics } from '../../services/financeService'
import { financeLiquidityProjection } from '../../services/financeLiquidityProjection'
import type { FinanceData } from '../finance/financeTypes'
import type { Task } from '../../types'
import { timestampToLocalParts } from '../../lib/calendarDates'

export function paperChartAxisMxn(pesos: number) {
  const absolute = Math.abs(pesos)
  const scale = absolute >= 1_000_000 ? 1_000_000 : absolute >= 1_000 ? 1_000 : 1
  const suffix = scale === 1_000_000 ? 'M' : scale === 1_000 ? 'k' : ''
  return `${pesos < 0 ? '-' : ''}$${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(absolute / scale)}${suffix}`
}

/** Keep changes readable; the visible currency axis makes the scale explicit. */
export function paperChartDomain(values: number[]): [number, number] {
  const finite = values.filter(Number.isFinite)
  const minimum = finite.length ? Math.min(...finite) : 0
  const maximum = finite.length ? Math.max(...finite) : 0
  const padding = Math.max((maximum - minimum) * .16, Math.max(Math.abs(minimum), Math.abs(maximum)) * .025, 1)
  const lower = Math.floor(minimum - padding)
  return [minimum >= 0 ? Math.max(0, lower) : lower, Math.ceil(maximum + padding)]
}

/** The home uses the same conservative, dated projection as Finance. */
export function paperFinanceOverview(data: FinanceData, referenceDate = new Date()) {
  const month = startOfMonth(referenceDate)
  const metrics = calculateFinanceMetrics(data, month, referenceDate)
  const includedBudgetCategoryIds = [...new Set(canonicalFinanceBudgetGroups(data)
    .filter((group) => !group.isPersonal).map((group) => group.budget.categoryId))]
  const project = (selectedMonth: Date) => financeLiquidityProjection({
    data,
    month: selectedMonth,
    referenceDate,
    currentAvailableBalanceCents: metrics.availableBalanceCents,
    minimumOperatingBufferCents: data.liquidityPreference.minimumOperatingBufferCents,
    includePersonalBudgetReservations: true,
    includedBudgetCategoryIds,
    carryIncludePersonalBudgetReservations: true,
    carryIncludedBudgetCategoryIds: includedBudgetCategoryIds,
  })
  const projection = project(month)
  const checkpointDate = setDate(referenceDate.getDate() < 15 ? month : addMonths(month, 1), 15)
  const checkpointKey = format(checkpointDate, 'yyyy-MM-dd')
  const checkpointProjection = checkpointDate.getMonth() === month.getMonth() ? projection : project(checkpointDate)
  const checkpointBalanceCents = checkpointProjection.days.find((day) => day.date === checkpointKey)?.balanceCents
  const chart = projection.days.map((day) => ({
    date: day.date,
    // Today's projection can already include unpaid commitments due today or
    // overdue. They belong to the projected line, never to realized cash.
    actual: day.date === projection.currentDate ? metrics.availableBalanceCents / 100
      : day.date < projection.currentDate ? day.balanceCents / 100 : null,
    projected: day.date >= projection.currentDate ? day.balanceCents / 100 : null,
    balance: day.balanceCents / 100,
  }))
  return { metrics, projection, chart, checkpointDate, checkpointBalanceCents }
}

/** Keep unscheduled work in Backlog; the home prioritizes work due or underway. */
export function paperTodayTasks(tasks: Task[], today: string) {
  const priority: Record<Task['priority'], number> = { critical: 0, high: 1, medium: 2, low: 3 }
  const dueDate = (task: Task) => task.dueAt ? timestampToLocalParts(task.dueAt).date : task.dueDate
  return tasks.filter((task) => !task.archivedAt && task.status !== 'done'
    && (Boolean(dueDate(task) && dueDate(task)! <= today)
      || task.status === 'doing'))
    .sort((a, b) => (dueDate(a) ?? today).localeCompare(dueDate(b) ?? today)
      || priority[a.priority] - priority[b.priority]
      || Number(b.status === 'doing') - Number(a.status === 'doing')
      || a.title.localeCompare(b.title, 'es'))
    .slice(0, 4)
}
