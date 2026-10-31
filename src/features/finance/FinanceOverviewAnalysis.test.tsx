import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FinanceOverviewAnalysis } from './FinanceOverviewAnalysis'

const month = new Date(2026, 9, 1)

describe('monthly overview analysis', () => {
  it('handles an empty month without ratios, invented spending, or a misleading surplus', () => {
    render(<FinanceOverviewAnalysis flow={{ incomeCents: 0, expenseCents: 0, netCents: 0 }} categories={[]} month={month} />)
    expect(screen.getByText('Sin movimientos')).toBeInTheDocument()
    expect(screen.getByText('Sin gastos por categoría')).toBeInTheDocument()
    expect(screen.getByText(/Aún no hay ingresos ni gastos realizados/)).toBeInTheDocument()
    expect(screen.queryByText('Excedente')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ver todas las categorías/ })).not.toBeInTheDocument()
  })

  it('shows a negative net and explains spending without income in MXN', () => {
    render(<FinanceOverviewAnalysis flow={{ incomeCents: 0, expenseCents: 125_000, netCents: -125_000 }} categories={[{ name: 'Renta', value: 125_000 }]} month={month} />)
    const card = screen.getByRole('article', { name: 'Flujo del mes' })
    expect(within(card).getByText('Déficit')).toBeInTheDocument()
    expect(within(card).getByText('-$1,250.00')).toBeInTheDocument()
    expect(within(card).getByText('Hay $1,250.00 de gastos y ningún ingreso cobrado en este periodo.')).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'En qué se fue' })).getByText('100%')).toBeInTheDocument()
  })

  it('calculates every share against all categories and reveals the complete remainder with an accessible toggle', () => {
    const categories = [{ name: 'Renta', value: 50_000 }, { name: 'Comida', value: 10_000 }, { name: 'Gasolina', value: 10_000 }, { name: 'Internet', value: 10_000 }, { name: 'Moto', value: 10_000 }, { name: 'Libros', value: 5_000 }, { name: 'Café', value: 5_000 }]
    const { rerender } = render(<FinanceOverviewAnalysis flow={{ incomeCents: 150_000, expenseCents: 100_000, netCents: 50_000 }} categories={categories} month={month} />)
    const card = screen.getByRole('article', { name: 'En qué se fue' })
    expect(within(card).getByText('$1,000.00')).toBeInTheDocument()
    expect(within(card).getByText('50%')).toBeInTheDocument()
    expect(within(card).getAllByRole('listitem')).toHaveLength(5)
    const expand = within(card).getByRole('button', { name: /Ver todas las categorías/ })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(expand)
    expect(within(card).getAllByRole('listitem')).toHaveLength(7)
    expect(within(card).getAllByText('5%')).toHaveLength(2)
    expect(expand).toHaveAttribute('aria-expanded', 'true')
    rerender(<FinanceOverviewAnalysis flow={{ incomeCents: 160_000, expenseCents: 100_000, netCents: 60_000 }} categories={categories} month={month} />)
    expect(within(card).getByRole('button', { name: /Mostrar sólo las 5 principales/ })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(within(card).getByRole('button', { name: /Mostrar sólo las 5 principales/ }))
    expect(within(card).getAllByRole('listitem')).toHaveLength(5)
  })

  it('compares income and expense on a shared scale while reporting the deficit as a signed amount', () => {
    const { container } = render(<FinanceOverviewAnalysis flow={{ incomeCents: 100_000, expenseCents: 200_000, netCents: -100_000 }} categories={[{ name: 'Gastos', value: 200_000 }]} month={month} />)
    expect(screen.getByText('Los gastos superan a los ingresos en $1,000.00.')).toBeInTheDocument()
    const incomeBar = container.querySelector('.is-income .finance-overview-analysis__track > span')
    const expenseBar = container.querySelector('.is-expense .finance-overview-analysis__track > span')
    expect(incomeBar).toHaveStyle({ width: '50%' })
    expect(expenseBar).toHaveStyle({ width: '100%' })
  })

  it('explains completed refunds without changing net flow or the original category amounts', () => {
    render(<FinanceOverviewAnalysis flow={{ incomeCents: 10_000, expenseCents: 4_000, netCents: 6_000 }} categories={[{ name: 'Compras', value: 5_000 }]} refundCents={1_000} month={month} />)
    const flow = screen.getByRole('article', { name: 'Flujo del mes' })
    const categories = screen.getByRole('article', { name: 'En qué se fue' })
    expect(within(flow).getByText('$40.00')).toBeInTheDocument()
    expect(within(flow).getByText('$60.00')).toBeInTheDocument()
    expect(within(categories).getAllByText('$50.00')).toHaveLength(2)
    expect(within(categories).getByText('Importes antes de reembolsos. El gasto del flujo descuenta $10.00 en reembolsos; las categorías muestran importes originales.')).toBeInTheDocument()
  })

  it('acknowledges the existing zero expense floor when refunds exceed original spending', () => {
    render(<FinanceOverviewAnalysis flow={{ incomeCents: 10_000, expenseCents: 0, netCents: 10_000 }} categories={[{ name: 'Compras', value: 5_000 }]} refundCents={7_000} month={month} />)
    expect(screen.getByText('Importes antes de reembolsos. Hay $70.00 en reembolsos; el gasto neto del flujo se limita a $0.00. Las categorías muestran los importes originales.')).toBeInTheDocument()
  })
})
