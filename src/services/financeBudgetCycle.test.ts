import { describe, expect, it } from 'vitest'
import { fortnightPeriodForDate, nextFortnightPeriod, planFortnightClosure } from './financeBudgetCycle'

describe('financeBudgetCycle', () => {
  it('distingue ambas quincenas del mismo mes con períodos inequívocos', () => {
    expect(fortnightPeriodForDate('2026-08-01')).toEqual({
      month: '2026-08-01', periodStart: '2026-08-01', periodEnd: '2026-08-15',
    })
    expect(fortnightPeriodForDate('2026-08-16')).toEqual({
      month: '2026-08-01', periodStart: '2026-08-16', periodEnd: '2026-08-31',
    })
  })

  it('calcula Q1 a Q2 y Q2 a Q1 del siguiente mes', () => {
    expect(nextFortnightPeriod('2026-08-15')).toMatchObject({
      periodStart: '2026-08-16', periodEnd: '2026-08-31',
    })
    expect(nextFortnightPeriod('2026-08-31')).toMatchObject({
      month: '2026-09-01', periodStart: '2026-09-01', periodEnd: '2026-09-15',
    })
  })

  it('cruza diciembre a enero', () => {
    expect(nextFortnightPeriod('2026-12-31')).toEqual({
      month: '2027-01-01', periodStart: '2027-01-01', periodEnd: '2027-01-15',
    })
  })

  it('aplica carry-over una sola vez al crear el siguiente presupuesto', () => {
    expect(planFortnightClosure({
      currentPeriodEnd: '2026-08-15', currentPlannedAmountCents: 100_000,
      spentCents: 25_000, destination: 'next_period',
    })).toMatchObject({
      leftoverCents: 75_000, carryOverCents: 75_000, nextPlannedAmountCents: 175_000,
    })
  })

  it('conserva un siguiente presupuesto ya definido y sólo le suma el carry-over', () => {
    expect(planFortnightClosure({
      currentPeriodEnd: '2026-08-15', currentPlannedAmountCents: 100_000,
      spentCents: 25_000, destination: 'next_period', existingNextPlannedAmountCents: 220_000,
    }).nextPlannedAmountCents).toBe(295_000)
  })

  it('no arrastra saldo cuando el sobrante se destina fuera del siguiente período', () => {
    expect(planFortnightClosure({
      currentPeriodEnd: '2026-08-31', currentPlannedAmountCents: 100_000,
      spentCents: 25_000, destination: 'goal',
    })).toMatchObject({ carryOverCents: 0, nextPlannedAmountCents: 100_000 })
  })
})
