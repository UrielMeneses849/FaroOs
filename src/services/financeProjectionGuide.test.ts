import { describe, expect, it } from 'vitest'
import type { FinanceLiquidityProjection } from './financeLiquidityProjection'
import { financeProjectionGuide } from './financeProjectionGuide'

const projection = (overrides: Partial<FinanceLiquidityProjection>): FinanceLiquidityProjection => ({
  periodStart: '2027-01-01',
  periodEnd: '2027-01-31',
  periodMode: 'future',
  availableTodayCents: 2_000_000,
  openingBalanceCents: 2_000_000,
  openingBalanceSource: 'prior_projected_close',
  minimumBalanceCents: 1_000_000,
  minimumDate: '2027-01-20',
  closingBalanceCents: 1_200_000,
  freeMarginCents: 500_000,
  status: 'stable',
  days: [{ date: '2027-01-20', balanceCents: 1_000_000, incomeCents: 200_000, expenseCents: 1_200_000, events: [], isCurrent: false }],
  events: [],
  sensitivePeriods: [],
  currentDate: '2026-10-10',
  computeMs: 0,
  ...overrides,
})

describe('financeProjectionGuide', () => {
  it('ordena el riesgo, calcula la meta preventiva y una aportación mensual conservadora', () => {
    const guide = financeProjectionGuide([
      projection({ periodStart: '2027-04-01', periodEnd: '2027-04-30', minimumBalanceCents: 76_000, minimumDate: '2027-04-24', closingBalanceCents: 849_000, status: 'critical' }),
      projection({ periodStart: '2027-05-01', periodEnd: '2027-05-31', openingBalanceCents: 849_000, minimumBalanceCents: -901_999, minimumDate: '2027-05-20', closingBalanceCents: -128_999, status: 'critical' }),
      projection({ periodStart: '2027-06-01', periodEnd: '2027-06-30', openingBalanceCents: -128_999, minimumBalanceCents: -500_000, minimumDate: '2027-06-20', closingBalanceCents: 100_000, status: 'critical' }),
    ], 500_000, new Date(2026, 9, 10))

    expect(guide?.worstMonth.periodStart).toBe('2027-05-01')
    expect(guide?.secondWorstMonth?.periodStart).toBe('2027-06-01')
    expect(guide?.firstCriticalMonth?.periodStart).toBe('2027-04-01')
    expect(guide?.protectionTargetCents).toBe(1_410_000)
    expect(guide?.suggestedMonthlyReserveCents).toBe(210_000)
    expect(guide?.months.find((month) => month.periodStart === '2027-05-01')).toMatchObject({
      bufferGapCents: 1_401_999,
      attentionRank: 1,
      netChangeCents: -977_999,
    })
  })

  it('recomienda cero cuando todos los meses conservan el colchón', () => {
    const guide = financeProjectionGuide([
      projection({ minimumBalanceCents: 900_000, status: 'stable' }),
      projection({ periodStart: '2027-02-01', periodEnd: '2027-02-28', minimumBalanceCents: 700_000, minimumDate: '2027-02-18', status: 'stable' }),
    ], 500_000, new Date(2026, 9, 10))

    expect(guide?.protectionTargetCents).toBe(0)
    expect(guide?.suggestedMonthlyReserveCents).toBe(0)
    expect(guide?.firstCriticalMonth).toBeUndefined()
  })
})
