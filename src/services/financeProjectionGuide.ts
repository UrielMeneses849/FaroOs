import { differenceInCalendarMonths, parseISO, startOfMonth } from 'date-fns'
import type { FinanceLiquidityProjection, FinanceLiquidityRadarStatus } from './financeLiquidityProjection'

export interface FinanceProjectionGuideMonth {
  periodStart: string
  periodEnd: string
  minimumBalanceCents: number
  minimumDate: string
  closingBalanceCents: number
  netChangeCents: number
  incomeCents: number
  expenseCents: number
  bufferGapCents: number
  status: FinanceLiquidityRadarStatus
  attentionRank: number
}

export interface FinanceProjectionGuide {
  months: FinanceProjectionGuideMonth[]
  worstMonth: FinanceProjectionGuideMonth
  secondWorstMonth?: FinanceProjectionGuideMonth
  firstCriticalMonth?: FinanceProjectionGuideMonth
  protectionTargetCents: number
  suggestedMonthlyReserveCents: number
  monthsToWorstPoint: number
}

const roundUpToHundredPesos = (amountCents: number) =>
  Math.ceil(Math.max(0, amountCents) / 10_000) * 10_000

export function financeProjectionGuide(
  projections: FinanceLiquidityProjection[],
  minimumOperatingBufferCents: number,
  referenceDate = new Date(),
): FinanceProjectionGuide | undefined {
  if (!projections.length) return undefined

  const bufferCents = Math.max(0, minimumOperatingBufferCents)
  const byRisk = [...projections].sort((left, right) =>
    left.minimumBalanceCents - right.minimumBalanceCents
    || left.minimumDate.localeCompare(right.minimumDate))
  const rankByPeriod = new Map(byRisk.map((projection, index) => [projection.periodStart, index + 1]))
  const months = projections.map((projection) => {
    const incomeCents = projection.days.reduce((total, day) => total + day.incomeCents, 0)
    const expenseCents = projection.days.reduce((total, day) => total + day.expenseCents, 0)
    return {
      periodStart: projection.periodStart,
      periodEnd: projection.periodEnd,
      minimumBalanceCents: projection.minimumBalanceCents,
      minimumDate: projection.minimumDate,
      closingBalanceCents: projection.closingBalanceCents,
      netChangeCents: projection.closingBalanceCents - projection.openingBalanceCents,
      incomeCents,
      expenseCents,
      bufferGapCents: Math.max(0, bufferCents - projection.minimumBalanceCents),
      status: projection.status,
      attentionRank: rankByPeriod.get(projection.periodStart) ?? projections.length,
    }
  })
  const worstMonth = months.find((month) => month.periodStart === byRisk[0].periodStart) ?? months[0]
  const secondWorstMonth = months.find((month) => month.periodStart === byRisk[1]?.periodStart)
  const firstCriticalMonth = months.find((month) => month.status === 'critical')
  const referenceMonth = startOfMonth(referenceDate)
  const suggestedMonthlyReserveCents = roundUpToHundredPesos(months.reduce((largest, month) => {
    if (!month.bufferGapCents) return largest
    const monthsAvailable = Math.max(1, differenceInCalendarMonths(parseISO(month.minimumDate), referenceMonth))
    return Math.max(largest, month.bufferGapCents / monthsAvailable)
  }, 0))

  return {
    months,
    worstMonth,
    secondWorstMonth,
    firstCriticalMonth,
    protectionTargetCents: roundUpToHundredPesos(worstMonth.bufferGapCents),
    suggestedMonthlyReserveCents,
    monthsToWorstPoint: Math.max(1, differenceInCalendarMonths(parseISO(worstMonth.minimumDate), referenceMonth)),
  }
}
