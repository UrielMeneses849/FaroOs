import { describe, expect, it } from 'vitest'
import type { FinanceData, FinanceTransaction } from '../finance/financeTypes'
import type { Task } from '../../types'
import { paperChartAxisMxn, paperChartDomain, paperFinanceOverview, paperTodayTasks } from './paperDashboardMetrics'

const baseMovement: FinanceTransaction = { id: 'income', accountId: 'cash', type: 'income', amountCents: 200_000, transactionDate: '2026-10-01', description: 'Ingreso registrado', status: 'completed', createdAt: '', updatedAt: '' }
const finance: FinanceData = {
  accounts: [{ id: 'cash', name: 'Cuenta principal', type: 'checking', currency: 'MXN', initialBalanceCents: 1_000_000, isActive: true, createdAt: '', updatedAt: '' }],
  categories: [], transactions: [baseMovement,
    { ...baseMovement, id: 'expense', type: 'expense', amountCents: 50_000, transactionDate: '2026-10-03' },
    { ...baseMovement, id: 'future-expense', type: 'expense', amountCents: 100_000, status: 'pending', transactionDate: '2026-10-20' },
    { ...baseMovement, id: 'future-income', amountCents: 300_000, status: 'planned', transactionDate: '2026-10-25' }],
  recurring: [], recurringOccurrences: [], budgets: [], goals: [], contributions: [], budgetClosures: [], savingsFundEntries: [], goalItems: [],
  liquidityPreference: { minimumOperatingBufferCents: 150_000 }, liquiditySnapshots: [],
}
const task: Task = { id: 'today', title: 'Tarea de hoy', status: 'todo', area: 'personal', priority: 'medium', dueDate: '2026-10-10', createdAt: '', updatedAt: '' }

describe('Paper home financial overview', () => {
  it('separa saldo real de compromisos pendientes sin volver a descontarlos del disponible', () => {
    const result = paperFinanceOverview(finance, new Date(2026, 9, 10, 12))
    expect(result.metrics.availableBalanceCents).toBe(1_150_000)
    expect(result.metrics.monthlyIncomeCents).toBe(200_000)
    expect(result.metrics.monthlyExpensesCents).toBe(50_000)
    expect(result.projection.closingBalanceCents).toBe(1_350_000)
    expect(result.checkpointBalanceCents).toBe(1_150_000)
    expect(result.chart.find((day) => day.date === '2026-10-20')).toMatchObject({ actual: null, projected: 10_500 })
    expect(result.chart.find((day) => day.date === '2026-10-25')).toMatchObject({ actual: null, projected: 13_500 })
    expect(result.chart.find((day) => day.date === '2026-10-03')).toMatchObject({ actual: 11_500, projected: null })
  })

  it('lleva el próximo corte a enero al pasar el 15 de diciembre', () => {
    const result = paperFinanceOverview({ ...finance, transactions: [] }, new Date(2026, 11, 27, 12))
    expect(result.checkpointDate.getFullYear()).toBe(2027)
    expect(result.checkpointDate.getMonth()).toBe(0)
    expect(result.checkpointDate.getDate()).toBe(15)
    expect(result.checkpointBalanceCents).toBe(1_000_000)
  })

  it('mantiene el punto Real de hoy en el saldo realizado al haber compromisos de hoy y vencidos', () => {
    const result = paperFinanceOverview({ ...finance, transactions: [...finance.transactions,
      { ...baseMovement, id: 'due-today', type: 'expense', amountCents: 100_000, status: 'planned', transactionDate: '2026-10-10' },
      { ...baseMovement, id: 'overdue', type: 'expense', amountCents: 50_000, status: 'pending', transactionDate: '2026-10-08' },
    ] }, new Date(2026, 9, 10, 12))
    expect(result.metrics.availableBalanceCents).toBe(1_150_000)
    expect(result.chart.find((day) => day.date === '2026-10-09')).toMatchObject({ actual: 11_500, projected: null })
    expect(result.chart.find((day) => day.date === '2026-10-10')).toMatchObject({ actual: 11_500, projected: 10_000, balance: 10_000 })
    expect(result.projection.closingBalanceCents).toBe(1_200_000)
  })
})

describe('Paper home task priorities', () => {
  it('prioriza vencidas y trabajo en curso, excluyendo futuras, completadas y archivadas', () => {
    const result = paperTodayTasks([task,
      { ...task, id: 'future', dueDate: '2026-10-11' },
      { ...task, id: 'done', status: 'done' },
      { ...task, id: 'archive', archivedAt: '2026-10-09' },
      { ...task, id: 'doing', status: 'doing', dueDate: undefined },
      { ...task, id: 'overdue', dueDate: '2026-10-09' },
      { ...task, id: 'critical', priority: 'critical' },
    ], '2026-10-10')
    expect(result.map((item) => item.id)).toEqual(['overdue', 'critical', 'doing', 'today'])
  })
})

describe('Paper home readable currency axis', () => {
  it('muestra escalas de dinero compactas y conserva valores negativos', () => {
    expect(paperChartAxisMxn(40_000)).toBe('$40k')
    expect(paperChartAxisMxn(52_500)).toBe('$52.5k')
    expect(paperChartAxisMxn(-20_000)).toBe('-$20k')
    expect(paperChartAxisMxn(1_200_000)).toBe('$1.2M')
  })

  it('da margen a los datos sin forzar cero cuando ocultaría las variaciones', () => {
    const [lower, upper] = paperChartDomain([51_745, 54_245, 55_000])
    expect(lower).toBeGreaterThan(0)
    expect(lower).toBeLessThan(51_745)
    expect(upper).toBeGreaterThan(55_000)
    expect(paperChartDomain([0, 0])).toEqual([0, 1])
    expect(paperChartDomain([-3_000, -2_000])[0]).toBeLessThan(-3_000)
  })
})
