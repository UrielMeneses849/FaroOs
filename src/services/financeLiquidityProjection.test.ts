import { describe, expect, it } from 'vitest'
import type { FinanceData, FinanceTransaction } from '../features/finance/financeTypes'
import {
  financeLiquidityDeviation,
  financeLiquidityProjection,
  financeLiquidityStatus,
} from './financeLiquidityProjection'

const createdAt = '2026-07-01T00:00:00.000Z'
const account = { id: 'account', name: 'Operativa', type: 'checking' as const, currency: 'MXN', initialBalanceCents: 1_000_000, isActive: true, createdAt, updatedAt: createdAt }
const movement = (overrides: Partial<FinanceTransaction>): FinanceTransaction => ({
  id: crypto.randomUUID(), accountId: 'account', type: 'expense', amountCents: 10_000,
  transactionDate: '2026-07-01', description: 'Movimiento', status: 'planned', createdAt, updatedAt: createdAt,
  ...overrides,
})
const financeData = (transactions: FinanceTransaction[] = []): FinanceData => ({
  accounts: [account], categories: [], transactions, recurring: [], recurringOccurrences: [],
  budgets: [], goals: [], contributions: [], budgetClosures: [], savingsFundEntries: [], goalItems: [],
  liquidityPreference: { minimumOperatingBufferCents: 800_000 }, liquiditySnapshots: [],
})
const radar = (data: FinanceData, overrides: Partial<Parameters<typeof financeLiquidityProjection>[0]> = {}) => financeLiquidityProjection({
  data,
  month: new Date(2026, 6, 1),
  currentAvailableBalanceCents: 900_000,
  minimumOperatingBufferCents: 800_000,
  referenceDate: new Date(2026, 6, 10),
  ...overrides,
})

describe('financeLiquidityProjection', () => {
  it('calcula el saldo día a día, el mínimo y el margen libre', () => {
    const projection = radar(financeData([
      movement({ id: 'actual', transactionDate: '2026-07-02', amountCents: 100_000, status: 'completed' }),
      movement({ id: 'late', transactionDate: '2026-07-05', amountCents: 200_000 }),
      movement({ id: 'income', transactionDate: '2026-07-12', type: 'income', amountCents: 500_000 }),
    ]))
    expect(projection.days.find((day) => day.date === '2026-07-02')?.balanceCents).toBe(900_000)
    expect(projection.days.find((day) => day.date === '2026-07-10')?.balanceCents).toBe(700_000)
    expect(projection.minimumBalanceCents).toBe(700_000)
    expect(projection.minimumDate).toBe('2026-07-10')
    expect(projection.freeMarginCents).toBe(-100_000)
    expect(projection.events.find((event) => event.id === 'movement:late')).toMatchObject({ date: '2026-07-10', originalDate: '2026-07-05', isOverdue: true })
  })

  it('centraliza los estados estable, moderación y crítico', () => {
    expect(financeLiquidityStatus(1_000_001, 800_000)).toBe('stable')
    expect(financeLiquidityStatus(900_000, 800_000)).toBe('moderation')
    expect(financeLiquidityStatus(800_000, 800_000)).toBe('critical')
  })

  it('mantiene el salto de un ingreso grande exactamente en su fecha', () => {
    const projection = radar(financeData([
      movement({ id: 'salary', transactionDate: '2026-07-31', type: 'income', amountCents: 4_500_000 }),
    ]))
    expect(projection.days.find((day) => day.date === '2026-07-30')?.balanceCents).toBe(900_000)
    expect(projection.days.find((day) => day.date === '2026-07-31')?.balanceCents).toBe(5_400_000)
  })

  it('agrega varios movimientos en un mismo día', () => {
    const projection = radar(financeData([
      movement({ id: 'food', transactionDate: '2026-07-15', amountCents: 150_000 }),
      movement({ id: 'fuel', transactionDate: '2026-07-15', amountCents: 150_000 }),
      movement({ id: 'debt', transactionDate: '2026-07-15', type: 'debt_payment', amountCents: 300_000 }),
    ]))
    const day = projection.days.find((item) => item.date === '2026-07-15')
    expect(day?.events).toHaveLength(3)
    expect(day?.expenseCents).toBe(600_000)
    expect(day?.balanceCents).toBe(300_000)
  })

  it('permite alternar entre flujo fechado y escenario con reserva personal Q1/Q2', () => {
    const data = financeData([
      movement({ id: 'personal-plan', categoryId: 'personal', transactionDate: '2026-07-15', amountCents: 100_000 }),
    ])
    data.categories = [{ id: 'personal', name: 'Personal', type: 'expense', isDefault: false, isActive: true }]
    data.budgets = [
      { id: 'old-q1', categoryId: 'personal', month: '2026-07-01', plannedAmountCents: 500_000, name: 'Gastos Personales', periodStart: '2026-07-01', periodEnd: '2026-07-15', createdAt, updatedAt: createdAt },
      { id: 'q1', categoryId: 'personal', month: '2026-07-01', plannedAmountCents: 500_000, name: 'Gastos Personales', periodStart: '2026-07-01', periodEnd: '2026-07-15', createdAt, updatedAt: '2026-07-02T00:00:00.000Z' },
      { id: 'q2', categoryId: 'personal', month: '2026-07-01', plannedAmountCents: 300_000, name: 'Gastos Personales', periodStart: '2026-07-16', periodEnd: '2026-07-31', createdAt, updatedAt: createdAt },
    ]
    const projection = radar(data)
    expect(projection.events.some((event) => event.id.startsWith('budget:'))).toBe(false)
    expect(projection.days.find((day) => day.date === '2026-07-10')?.balanceCents).toBe(900_000)
    expect(projection.days.find((day) => day.date === '2026-07-16')?.balanceCents).toBe(800_000)
    // The real planned movement remains visible at its own due date.
    expect(projection.days.find((day) => day.date === '2026-07-10')?.events).toEqual([])
    expect(projection.days.find((day) => day.date === '2026-07-15')?.events).toMatchObject([
      { id: 'movement:personal-plan', amountCents: -100_000 },
    ])

    const withReservation = radar(data, { includePersonalBudgetReservations: true })
    expect(withReservation.events.find((event) => event.id === 'budget:q1')).toMatchObject({
      date: '2026-07-11', amountCents: -400_000,
    })
    expect(withReservation.events.find((event) => event.id === 'budget:q2')).toMatchObject({
      date: '2026-07-16', amountCents: -300_000,
    })
    // The current point remains the actual balance. Only the future unplanned
    // part of the envelope is reserved, so a dated personal movement is never
    // cancelled with a fictional credit.
    expect(withReservation.days.find((day) => day.date === '2026-07-10')?.balanceCents).toBe(900_000)
    expect(withReservation.days.find((day) => day.date === '2026-07-15')?.balanceCents).toBe(400_000)
    expect(withReservation.days.find((day) => day.date === '2026-07-16')?.balanceCents).toBe(100_000)
  })

  it('mantiene el gasto personal realizado como saldo real y reserva sólo el remanente futuro', () => {
    const data = financeData([
      movement({ id: 'coffee', categoryId: 'personal', transactionDate: '2026-07-05', amountCents: 100_000, status: 'completed', description: 'Café' }),
    ])
    data.categories = [{ id: 'personal', name: 'Personal', type: 'expense', isDefault: false, isActive: true }]
    data.budgets = [{
      id: 'q1', categoryId: 'personal', month: '2026-07-01', plannedAmountCents: 500_000,
      name: 'Gastos Personales', periodStart: '2026-07-01', periodEnd: '2026-07-15',
      createdAt, updatedAt: createdAt,
    }]

    const projection = radar(data, { includePersonalBudgetReservations: true })
    const day = projection.days.find((item) => item.date === '2026-07-05')
    expect(day?.events).toMatchObject([
      { id: 'movement:coffee', amountCents: -100_000 },
    ])
    expect(day?.balanceCents).toBe(900_000)
    expect(projection.days.find((item) => item.date === '2026-07-10')?.balanceCents).toBe(900_000)
    expect(projection.days.find((item) => item.date === '2026-07-11')?.balanceCents).toBe(500_000)
  })

  it('fecha el ahorro realizado y proyecta el ahorro pendiente en el disponible operativo', () => {
    const completed = radar(financeData([
      movement({ id: 'saved', type: 'saving', transactionDate: '2026-07-05', amountCents: 200_000, status: 'completed' }),
    ]), { currentAvailableBalanceCents: 800_000 })
    const planned = radar(financeData([
      movement({ id: 'save-next', type: 'saving', transactionDate: '2026-07-12', amountCents: 200_000, status: 'planned' }),
    ]), { currentAvailableBalanceCents: 1_000_000 })

    expect(completed.days.find((day) => day.date === '2026-07-04')?.balanceCents).toBe(1_000_000)
    expect(completed.days.find((day) => day.date === '2026-07-05')?.balanceCents).toBe(800_000)
    expect(completed.days.find((day) => day.date === '2026-07-10')?.balanceCents).toBe(800_000)
    expect(planned.events.find((event) => event.id === 'movement:save-next')).toMatchObject({ amountCents: -200_000 })
    expect(planned.closingBalanceCents).toBe(800_000)
  })

  it('mantiene fuera del disponible operativo los movimientos de cuentas inactivas', () => {
    const data = financeData([
      movement({ id: 'inactive-plan', accountId: 'archived', transactionDate: '2026-07-12', amountCents: 300_000 }),
      movement({ id: 'inactive-saving', accountId: 'archived', type: 'saving', transactionDate: '2026-07-05', amountCents: 200_000, status: 'completed' }),
    ])
    data.accounts.push({ ...account, id: 'archived', name: 'Archivada', initialBalanceCents: 500_000, isActive: false })
    data.recurring = [{ id: 'inactive-income', accountId: 'archived', type: 'income', amountCents: 400_000, description: 'Ingreso archivado', frequency: 'monthly', startDate: '2026-01-01', nextOccurrence: '2026-07-20', isActive: true, createdAt, updatedAt: createdAt }]
    data.recurringOccurrences = [{ id: 'inactive-income-july', recurringTransactionId: 'inactive-income', period: '2026-07-01', expectedDate: '2026-07-20', amountCents: 400_000, status: 'pending', createdAt, updatedAt: createdAt }]

    const projection = radar(data, { currentAvailableBalanceCents: 1_000_000 })
    expect(projection.events).toEqual([])
    expect(projection.openingBalanceCents).toBe(1_000_000)
    expect(projection.closingBalanceCents).toBe(1_000_000)
  })

  it('sólo proyecta transferencias que cruzan el límite de cuentas activas', () => {
    const data = financeData([
      movement({ id: 'to-archived', type: 'transfer', accountId: 'account', destinationAccountId: 'archived', transactionDate: '2026-07-12', amountCents: 100_000 }),
      movement({ id: 'from-archived', type: 'transfer', accountId: 'archived', destinationAccountId: 'account', transactionDate: '2026-07-13', amountCents: 50_000 }),
      movement({ id: 'between-active', type: 'transfer', accountId: 'account', destinationAccountId: 'active-two', transactionDate: '2026-07-14', amountCents: 300_000 }),
    ])
    data.accounts.push(
      { ...account, id: 'archived', name: 'Archivada', initialBalanceCents: 500_000, isActive: false },
      { ...account, id: 'active-two', name: 'Operativa 2', initialBalanceCents: 0 },
    )

    const projection = radar(data, { currentAvailableBalanceCents: 1_000_000 })
    expect(projection.events.map((event) => [event.id, event.amountCents])).toEqual([
      ['movement:to-archived', -100_000],
      ['movement:from-archived', 50_000],
    ])
    expect(projection.closingBalanceCents).toBe(950_000)
  })

  it('no deja que un escenario Q2 afecte la curva cuando el switch está apagado', () => {
    const data = financeData()
    data.categories = [{ id: 'personal', name: 'Personal', type: 'expense', isDefault: false, isActive: true }]
    const scenario = { periodStart: '2026-07-16', periodEnd: '2026-07-31', targetAmountCents: 250_000 }
    const off = radar(data, { personalBudgetScenario: scenario })
    const on = radar(data, { includePersonalBudgetReservations: true, personalBudgetScenario: scenario })
    expect(off.events.find((event) => event.id === 'budget-scenario:2026-07-16')).toBeUndefined()
    expect(on.events.find((event) => event.id === 'budget-scenario:2026-07-16')).toMatchObject({ amountCents: -250_000 })
  })

  it('no duplica una recurrencia cuando existe un movimiento materializado', () => {
    const data = financeData([
      movement({ id: 'materialized', recurringTransactionId: 'phone', transactionDate: '2026-07-15', amountCents: 50_000 }),
    ])
    data.recurring = [{ id: 'phone', accountId: 'account', type: 'expense', amountCents: 50_000, description: 'Teléfono', frequency: 'monthly', startDate: '2026-01-01', nextOccurrence: '2026-07-15', isActive: true, createdAt, updatedAt: createdAt }]
    data.recurringOccurrences = [{ id: 'phone-july', recurringTransactionId: 'phone', period: '2026-07-01', expectedDate: '2026-07-15', amountCents: 50_000, status: 'pending', transactionId: 'materialized', createdAt, updatedAt: createdAt }]
    const day = radar(data).days.find((item) => item.date === '2026-07-15')
    expect(day?.events).toHaveLength(1)
    expect(day?.expenseCents).toBe(50_000)
  })

  it('no reaplica un movimiento completado por adelantado que ya forma parte del saldo real', () => {
    const data = financeData([
      movement({ id: 'paid-early', transactionDate: '2026-07-15', amountCents: 100_000, status: 'completed' }),
    ])
    const projection = radar(data, { currentAvailableBalanceCents: 900_000 })

    expect(projection.events.find((event) => event.id === 'movement:paid-early')).toBeUndefined()
    expect(projection.days.find((day) => day.date === '2026-07-15')?.balanceCents).toBe(900_000)
    expect(projection.closingBalanceCents).toBe(900_000)
  })

  it('no vuelve a aplicar en un mes futuro un completado ya incluido en el saldo de hoy', () => {
    const data = financeData([
      movement({ id: 'future-paid', transactionDate: '2026-08-20', amountCents: 100_000, status: 'completed' }),
    ])
    const august = financeLiquidityProjection({
      data,
      month: new Date(2026, 7, 1),
      currentAvailableBalanceCents: 900_000,
      minimumOperatingBufferCents: 0,
      referenceDate: new Date(2026, 6, 10),
    })

    expect(august.openingBalanceCents).toBe(900_000)
    expect(august.events.find((event) => event.id === 'movement:future-paid')).toBeUndefined()
    expect(august.closingBalanceCents).toBe(900_000)
  })

  it('mantiene proyectada una recurrencia marcada pagada si falta su movimiento contable', () => {
    const data = financeData()
    data.recurring = [{ id: 'rent', accountId: 'account', type: 'expense', amountCents: 100_000, description: 'Renta', frequency: 'monthly', startDate: '2026-01-01', nextOccurrence: '2026-07-15', isActive: true, createdAt, updatedAt: createdAt }]
    data.recurringOccurrences = [{ id: 'rent-july', recurringTransactionId: 'rent', period: '2026-07-01', expectedDate: '2026-07-15', amountCents: 100_000, status: 'paid', createdAt, updatedAt: createdAt }]

    const projection = radar(data)
    expect(projection.events.find((event) => event.id === 'recurring:rent-july')).toMatchObject({ amountCents: -100_000 })
    expect(projection.closingBalanceCents).toBe(800_000)
  })

  it('excluye cancelados y usa la fecha pospuesta de una ocurrencia', () => {
    const data = financeData([
      movement({ id: 'cancelled', transactionDate: '2026-07-12', amountCents: 500_000, status: 'cancelled' }),
    ])
    data.recurring = [{ id: 'rent', accountId: 'account', type: 'expense', amountCents: 100_000, description: 'Renta', frequency: 'monthly', startDate: '2026-01-01', nextOccurrence: '2026-07-04', isActive: true, createdAt, updatedAt: createdAt }]
    data.recurringOccurrences = [{ id: 'rent-july', recurringTransactionId: 'rent', period: '2026-07-01', expectedDate: '2026-07-20', amountCents: 100_000, status: 'postponed', createdAt, updatedAt: createdAt }]
    const projection = radar(data)
    expect(projection.events.find((event) => event.id === 'movement:cancelled')).toBeUndefined()
    expect(projection.days.find((day) => day.date === '2026-07-20')?.expenseCents).toBe(100_000)
  })

  it('recalcula al revertir un movimiento y no conserva su impacto como real', () => {
    const paid = movement({ id: 'revertible', transactionDate: '2026-07-12', amountCents: 200_000, status: 'completed' })
    const completedProjection = radar(financeData([paid]), { currentAvailableBalanceCents: 800_000 })
    const revertedProjection = radar(financeData([{ ...paid, status: 'planned' }]), { currentAvailableBalanceCents: 1_000_000 })
    expect(completedProjection.days.find((day) => day.date === '2026-07-12')?.balanceCents).toBe(800_000)
    expect(revertedProjection.days.find((day) => day.date === '2026-07-12')?.balanceCents).toBe(800_000)
    expect(revertedProjection.events.find((event) => event.id === 'movement:revertible')?.source).toBe('movement')
  })

  it('construye correctamente meses distintos, incluyendo diciembre y enero', () => {
    const december = financeLiquidityProjection({ data: financeData(), month: new Date(2026, 11, 1), currentAvailableBalanceCents: 900_000, minimumOperatingBufferCents: 800_000, referenceDate: new Date(2026, 10, 20) })
    const january = financeLiquidityProjection({ data: financeData(), month: new Date(2027, 0, 1), currentAvailableBalanceCents: 900_000, minimumOperatingBufferCents: 800_000, referenceDate: new Date(2026, 10, 20) })
    expect(december.days).toHaveLength(31)
    expect(december.periodEnd).toBe('2026-12-31')
    expect(january.days).toHaveLength(31)
    expect(january.periodStart).toBe('2027-01-01')
  })

  it('hereda el cierre proyectado del mes actual como apertura del siguiente', () => {
    const data = financeData([
      movement({ id: 'sep-expense', transactionDate: '2026-09-20', amountCents: 200_000 }),
      movement({ id: 'sep-income', transactionDate: '2026-09-30', type: 'income', amountCents: 500_000 }),
      movement({ id: 'oct-expense', transactionDate: '2026-10-01', amountCents: 430_000 }),
      movement({ id: 'oct-income', transactionDate: '2026-10-30', type: 'income', amountCents: 600_000 }),
    ])
    const shared = {
      data,
      currentAvailableBalanceCents: 1_000_000,
      minimumOperatingBufferCents: 0,
      referenceDate: new Date(2026, 8, 16),
    }
    const september = financeLiquidityProjection({ ...shared, month: new Date(2026, 8, 1) })
    const october = financeLiquidityProjection({ ...shared, month: new Date(2026, 9, 1) })

    expect(september.closingBalanceCents).toBe(1_300_000)
    expect(october).toMatchObject({
      periodMode: 'future',
      openingBalanceCents: september.closingBalanceCents,
      openingBalanceSource: 'prior_projected_close',
      openingBalanceSourcePeriod: '2026-09-01',
      closingBalanceCents: 1_470_000,
    })
    expect(october.days.find((day) => day.date === '2026-10-01')?.balanceCents).toBe(870_000)
  })

  it('encadena todos los meses intermedios, incluso en el cambio de año', () => {
    const data = financeData([
      movement({ id: 'sep', transactionDate: '2026-09-30', type: 'income', amountCents: 100_000 }),
      movement({ id: 'oct', transactionDate: '2026-10-31', type: 'income', amountCents: 200_000 }),
      movement({ id: 'nov', transactionDate: '2026-11-30', amountCents: 50_000 }),
      movement({ id: 'dec', transactionDate: '2026-12-31', type: 'income', amountCents: 300_000 }),
      movement({ id: 'jan', transactionDate: '2027-01-31', amountCents: 25_000 }),
    ])
    const january = financeLiquidityProjection({
      data,
      month: new Date(2027, 0, 1),
      currentAvailableBalanceCents: 1_000_000,
      minimumOperatingBufferCents: 0,
      referenceDate: new Date(2026, 8, 16),
    })
    expect(january.openingBalanceCents).toBe(1_550_000)
    expect(january.closingBalanceCents).toBe(1_525_000)
    expect(january.openingBalanceSourcePeriod).toBe('2026-12-01')
  })

  it('se reancla al saldo real cuando el mes proyectado se vuelve actual', () => {
    const data = financeData([
      movement({ id: 'sep-income', transactionDate: '2026-09-30', type: 'income', amountCents: 300_000 }),
      movement({ id: 'oct-expense', transactionDate: '2026-10-02', amountCents: 100_000 }),
    ])
    const seenFromSeptember = financeLiquidityProjection({
      data,
      month: new Date(2026, 9, 1),
      currentAvailableBalanceCents: 1_000_000,
      minimumOperatingBufferCents: 0,
      referenceDate: new Date(2026, 8, 16),
    })
    const activeOctober = financeLiquidityProjection({
      data,
      month: new Date(2026, 9, 1),
      currentAvailableBalanceCents: 1_250_000,
      minimumOperatingBufferCents: 0,
      referenceDate: new Date(2026, 9, 1),
    })

    expect(seenFromSeptember.openingBalanceCents).toBe(1_300_000)
    expect(activeOctober).toMatchObject({
      periodMode: 'current',
      openingBalanceCents: 1_250_000,
      openingBalanceSource: 'current_actual',
    })
  })

  it('propaga la misma política de reserva personal a través del arrastre', () => {
    const data = financeData()
    data.categories = [{ id: 'personal', name: 'Personal', type: 'expense', isDefault: false, isActive: true }]
    data.budgets = [{
      id: 'sep-q2', categoryId: 'personal', month: '2026-09-01', plannedAmountCents: 200_000,
      name: 'Gastos Personales', periodStart: '2026-09-16', periodEnd: '2026-09-30',
      createdAt, updatedAt: createdAt,
    }]
    const shared = {
      data,
      month: new Date(2026, 9, 1),
      currentAvailableBalanceCents: 1_000_000,
      minimumOperatingBufferCents: 0,
      referenceDate: new Date(2026, 8, 16),
    }
    const datedOnly = financeLiquidityProjection(shared)
    const withReserve = financeLiquidityProjection({ ...shared, includePersonalBudgetReservations: true })

    expect(datedOnly.openingBalanceCents).toBe(1_000_000)
    expect(withReserve.openingBalanceCents).toBe(800_000)
    expect(withReserve.events).toEqual([])
  })

  it('mantiene el pasado en datos realizados y no lo contamina con planes ni con el saldo de hoy', () => {
    const data = financeData([
      movement({ id: 'aug-paid', transactionDate: '2026-08-10', amountCents: 200_000, status: 'completed' }),
      movement({ id: 'aug-stale-plan', transactionDate: '2026-08-20', amountCents: 900_000, status: 'planned' }),
      movement({ id: 'sep-plan', transactionDate: '2026-09-30', type: 'income', amountCents: 500_000 }),
    ])
    data.categories = [{ id: 'personal', name: 'Personal', type: 'expense', isDefault: false, isActive: true }]
    data.budgets = [{
      id: 'aug-budget', categoryId: 'personal', month: '2026-08-01', plannedAmountCents: 500_000,
      name: 'Gastos Personales', periodStart: '2026-08-01', periodEnd: '2026-08-15',
      createdAt, updatedAt: createdAt,
    }]
    const projectAugust = (currentAvailableBalanceCents: number) => financeLiquidityProjection({
      data,
      month: new Date(2026, 7, 1),
      currentAvailableBalanceCents,
      minimumOperatingBufferCents: 0,
      referenceDate: new Date(2026, 8, 16),
      includePersonalBudgetReservations: true,
      simulation: { type: 'expense' as const, amountCents: 300_000, date: '2026-08-15' },
    })
    const first = projectAugust(100)
    const second = projectAugust(9_999_999)

    expect(first).toMatchObject({
      periodMode: 'past',
      openingBalanceCents: 1_000_000,
      openingBalanceSource: 'historical_actual',
      closingBalanceCents: 800_000,
    })
    expect(first.events.map((event) => event.id)).toEqual(['movement:aug-paid'])
    expect(second.closingBalanceCents).toBe(first.closingBalanceCents)
  })

  it('arrastra el ahorro histórico una sola vez al reconstruir un periodo cerrado', () => {
    const august = financeLiquidityProjection({
      data: financeData([
        movement({ id: 'july-saving', type: 'saving', transactionDate: '2026-07-20', amountCents: 200_000, status: 'completed' }),
      ]),
      month: new Date(2026, 7, 1),
      currentAvailableBalanceCents: 123,
      minimumOperatingBufferCents: 0,
      referenceDate: new Date(2026, 8, 16),
    })

    expect(august.openingBalanceCents).toBe(800_000)
    expect(august.closingBalanceCents).toBe(800_000)
  })

  it('aplica una simulación de gasto o de ingreso sólo al escenario de memoria', () => {
    const baseline = radar(financeData())
    const expense = radar(financeData(), { simulation: { type: 'expense', amountCents: 300_000, date: '2026-07-12', description: 'Celular' } })
    const income = radar(financeData(), { simulation: { type: 'income', amountCents: 300_000, date: '2026-07-12' } })
    expect(baseline.minimumBalanceCents).toBe(900_000)
    expect(expense.minimumBalanceCents).toBe(600_000)
    expect(income.closingBalanceCents).toBe(1_200_000)
    expect(financeData().transactions).toHaveLength(0)
  })

  it('simula la meta de Q2 desde el punto de quincena sin crear un segundo presupuesto', () => {
    const data = financeData([
      movement({ id: 'personal-q1', categoryId: 'personal', transactionDate: '2026-07-15', amountCents: 300_000 }),
      movement({ id: 'personal-q2', categoryId: 'personal', transactionDate: '2026-07-20', amountCents: 200_000 }),
    ])
    data.categories = [{ id: 'personal', name: 'Personal', type: 'expense', isDefault: false, isActive: true }]
    data.budgets = [{
      id: 'q1', categoryId: 'personal', month: '2026-07-01', plannedAmountCents: 500_000,
      name: 'Gastos Personales', periodStart: '2026-07-01', periodEnd: '2026-07-15',
      createdAt, updatedAt: createdAt,
    }]
    const scenario = radar(data, {
      includePersonalBudgetReservations: true,
      personalBudgetScenario: {
        periodStart: '2026-07-16',
        periodEnd: '2026-07-31',
        targetAmountCents: 500_000,
      },
    })
    expect(scenario.events.find((event) => event.id === 'budget-scenario:2026-07-16')).toMatchObject({
      date: '2026-07-16',
      amountCents: -500_000,
      source: 'simulation',
    })
    expect(scenario.events.find((event) => event.id === 'movement:personal-q2')).toMatchObject({
      amountCents: -200_000,
      source: 'movement',
    })
    expect(data.budgets).toHaveLength(1)
  })

  it('calcula la desviación contra el snapshot inicial sin persistirla', () => {
    expect(financeLiquidityDeviation(1_694_000, 1_828_300)).toBe(-134_300)
    expect(financeLiquidityDeviation(1_694_000)).toBeUndefined()
  })
})
