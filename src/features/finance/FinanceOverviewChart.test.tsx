import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { FinanceOverviewChart } from './FinanceOverviewChart'
import { financeLiquidityProjection } from '../../services/financeLiquidityProjection'
import type { FinanceData } from './financeTypes'

const plotted = vi.hoisted(() => ({ rows: [] as Array<{ date: string; actual: number | null; projected: number | null; balance: number }>, ticks: [] as string[] }))
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ data, children }: { data: typeof plotted.rows; children: ReactNode }) => { plotted.rows = data; return <div>{children}</div> },
  Line: ({ dataKey, dot, strokeDasharray }: { dataKey: string; dot: boolean | { r: number }; strokeDasharray?: string }) => <span data-testid={`series-${dataKey}`} data-dots={typeof dot === 'boolean' ? String(dot) : 'single'} data-dot-radius={typeof dot === 'object' ? dot.r : undefined} data-dash={strokeDasharray} />,
  XAxis: ({ ticks }: { ticks: string[] }) => { plotted.ticks = ticks; return null },
  Area: () => null, CartesianGrid: () => null, YAxis: () => null, ReferenceLine: () => null, Tooltip: () => null,
}))

function data(): FinanceData {
  return {
    accounts: [{ id: 'bank', name: 'Operativa', type: 'checking', currency: 'MXN', initialBalanceCents: 1_000_000, isActive: true, createdAt: '', updatedAt: '' }],
    categories: [], transactions: [
      { id: 'actual', accountId: 'bank', type: 'expense', amountCents: 100_000, transactionDate: '2026-07-02', description: 'Gasto realizado', status: 'completed', createdAt: '', updatedAt: '' },
      { id: 'pending-today', accountId: 'bank', type: 'expense', amountCents: 200_000, transactionDate: '2026-07-10', description: 'Pendiente de hoy', status: 'planned', createdAt: '', updatedAt: '' },
    ], recurring: [], recurringOccurrences: [], budgets: [], goals: [], contributions: [], budgetClosures: [], savingsFundEntries: [], goalItems: [],
    liquidityPreference: { minimumOperatingBufferCents: 800_000 }, liquiditySnapshots: [],
  }
}
const project = (month = new Date(2026, 6, 1)) => financeLiquidityProjection({
  data: data(), month, referenceDate: new Date(2026, 6, 10), currentAvailableBalanceCents: 900_000, minimumOperatingBufferCents: 800_000,
})

describe('Finance overview chart', () => {
  beforeEach(() => { plotted.rows = []; plotted.ticks = [] })

  it('keeps unpaid commitments on the projected curve while today uses the actual available balance', () => {
    const projection = project()
    const original = structuredClone(projection)
    render(<FinanceOverviewChart projection={projection} bufferCents={800_000} />)
    expect(plotted.rows.find(row => row.date === '2026-07-09')).toMatchObject({ actual: 9000, projected: null })
    expect(plotted.rows.find(row => row.date === '2026-07-10')).toMatchObject({ actual: 9000, projected: 7000 })
    expect(plotted.rows.find(row => row.date === '2026-07-11')).toMatchObject({ actual: null, projected: 7000 })
    expect(screen.getByTestId('series-actual')).toHaveAttribute('data-dots', 'false')
    expect(screen.getByTestId('series-actual')).not.toHaveAttribute('data-dash')
    expect(screen.getByTestId('series-projected')).toHaveAttribute('data-dots', 'false')
    expect(screen.getByTestId('series-projected')).toHaveAttribute('data-dash', '5 4')
    expect(plotted.ticks).toEqual(['2026-07-01', '2026-07-08', '2026-07-15', '2026-07-22', '2026-07-31'])
    expect(projection).toEqual(original)
  })

  it('uses the selected future month without presenting forecast values as realized', () => {
    const projection = project(new Date(2026, 7, 1))
    render(<FinanceOverviewChart projection={projection} bufferCents={800_000} />)
    expect(screen.getByRole('img', { name: /proyectado durante agosto de 2026/ })).toBeInTheDocument()
    expect(plotted.rows.every(row => row.actual === null && row.projected !== null)).toBe(true)
    const legend = screen.getByLabelText('Series de la gráfica')
    expect(within(legend).queryByText('Real')).not.toBeInTheDocument()
    expect(within(legend).getByText('Proyectado')).toBeInTheDocument()
    expect(screen.getByText('Disponible al 15').closest('article')).toHaveTextContent('Previsto · 15 ago')
  })

  it('presents closed months as historical and all three cards retain their actual dates and values', () => {
    const projection = project(new Date(2026, 5, 1))
    render(<FinanceOverviewChart projection={projection} bufferCents={800_000} />)
    expect(plotted.rows.every(row => row.actual !== null && row.projected === null)).toBe(true)
    expect(screen.getByRole('img', { name: /realizado durante junio de 2026/ })).toBeInTheDocument()
    const cards = screen.getByLabelText('Proyecciones del periodo')
    expect(within(cards).getAllByRole('article')).toHaveLength(3)
    expect(screen.getByText('Disponible al 15').closest('article')).toHaveTextContent('Realizado · 15 jun')
    expect(screen.getByText('Disponible al cierre').closest('article')).toHaveTextContent('Realizado · 30 jun')
    expect(screen.queryByText('Proyectado')).not.toBeInTheDocument()
  })

  it('shows the minimum signal in text and opens details without a mutating control', () => {
    const details = vi.fn()
    render(<FinanceOverviewChart projection={project()} bufferCents={800_000} onOpenDetails={details} />)
    const minimum = screen.getByText('Mínimo del periodo').closest('article')!
    expect(minimum).toHaveTextContent('$7,000.00')
    expect(minimum).toHaveTextContent('Bajo tu colchón')
    expect(minimum).toHaveTextContent('Previsto · 10 jul')
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }))
    expect(details).toHaveBeenCalledOnce()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('shows one subtle forecast marker on the last day without adding markers to the actual curve', () => {
    const projection = financeLiquidityProjection({ data: data(), month: new Date(2026, 6, 1), referenceDate: new Date(2026, 6, 31), currentAvailableBalanceCents: 900_000, minimumOperatingBufferCents: 800_000 })
    render(<FinanceOverviewChart projection={projection} bufferCents={800_000} />)
    expect(plotted.rows.filter(row => row.projected != null)).toHaveLength(1)
    expect(plotted.rows.at(-1)).toMatchObject({ date: '2026-07-31', actual: 9000, projected: 7000 })
    expect(screen.getByTestId('series-projected')).toHaveAttribute('data-dots', 'single')
    expect(screen.getByTestId('series-projected')).toHaveAttribute('data-dot-radius', '3')
    expect(screen.getByTestId('series-actual')).toHaveAttribute('data-dots', 'false')
  })
})
