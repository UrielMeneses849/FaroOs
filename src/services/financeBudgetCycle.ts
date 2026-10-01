export type BudgetCarryDestination = 'next_period' | 'goal' | 'savings_fund' | 'available'

export interface FortnightPeriod {
  month: string
  periodStart: string
  periodEnd: string
}

export type FortnightHalf = 'q1' | 'q2'

export interface FortnightClosurePlan {
  carryOverCents: number
  leftoverCents: number
  nextPeriod: FortnightPeriod
  nextPlannedAmountCents: number
  overrunCents: number
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function formatIsoDate(value: Date) {
  return value.toISOString().slice(0, 10)
}

function endOfUtcMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0))
}

export function fortnightPeriodForDate(date: string): FortnightPeriod {
  const value = parseIsoDate(date)
  const year = value.getUTCFullYear()
  const month = value.getUTCMonth()
  const isFirstHalf = value.getUTCDate() <= 15
  const periodStart = new Date(Date.UTC(year, month, isFirstHalf ? 1 : 16))
  const periodEnd = isFirstHalf ? new Date(Date.UTC(year, month, 15)) : endOfUtcMonth(value)

  return {
    month: formatIsoDate(new Date(Date.UTC(year, month, 1))),
    periodStart: formatIsoDate(periodStart),
    periodEnd: formatIsoDate(periodEnd),
  }
}

/** Returns a predictable Q1/Q2 period for a month, without relying on today. */
export function fortnightPeriodForMonth(month: string, half: FortnightHalf): FortnightPeriod {
  const value = parseIsoDate(month)
  return fortnightPeriodForDate(formatIsoDate(new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    half === 'q1' ? 1 : 16,
  ))))
}

export function nextFortnightPeriod(periodEnd: string) {
  const nextDate = parseIsoDate(periodEnd)
  nextDate.setUTCDate(nextDate.getUTCDate() + 1)
  return fortnightPeriodForDate(formatIsoDate(nextDate))
}

export function planFortnightClosure({
  currentPeriodEnd,
  currentPlannedAmountCents,
  spentCents,
  destination,
  existingNextPlannedAmountCents,
}: {
  currentPeriodEnd: string
  currentPlannedAmountCents: number
  spentCents: number
  destination: BudgetCarryDestination
  existingNextPlannedAmountCents?: number
}): FortnightClosurePlan {
  const leftoverCents = Math.max(0, currentPlannedAmountCents - spentCents)
  const overrunCents = Math.max(0, spentCents - currentPlannedAmountCents)
  const carryOverCents = destination === 'next_period' ? leftoverCents : 0
  const nextBudgetBaseCents = existingNextPlannedAmountCents ?? currentPlannedAmountCents

  return {
    leftoverCents,
    overrunCents,
    carryOverCents,
    nextPeriod: nextFortnightPeriod(currentPeriodEnd),
    nextPlannedAmountCents: nextBudgetBaseCents + carryOverCents,
  }
}
