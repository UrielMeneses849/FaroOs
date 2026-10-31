import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FinanceMonthlyOverview } from './FinanceMonthlyOverview'

describe('monthly overview comparison', () => {
  it('distinguishes higher expenses from favorable income and does not call unpaid spending savings', () => {
    render(<FinanceMonthlyOverview month={new Date(2026, 9, 1)} incomeCents={120000} expenseCents={150000} savingsRate={5} rows={[
      { label: 'Ingresos', planned: 100000, actual: 120000, difference: 20000 },
      { label: 'Gastos variables', planned: 100000, actual: 150000, difference: 50000 },
      { label: 'Gastos fijos', planned: 100000, actual: 50000, difference: -50000 },
      { label: 'Saldo al cierre', planned: 90000, actual: 120000, difference: 30000 },
    ]} />)
    const income = screen.getByRole('rowheader', { name: 'Ingresos' }).closest('tr')!
    const over = screen.getByRole('rowheader', { name: 'Gastos variables' }).closest('tr')!
    const below = screen.getByRole('rowheader', { name: 'Gastos fijos' }).closest('tr')!
    expect(within(income).getByText('+$200.00').closest('td')).toHaveClass('is-favorable')
    expect(within(over).getByText('Sobre lo previsto')).toBeInTheDocument()
    expect(within(over).getByText('+$500.00').closest('td')).toHaveClass('is-over')
    expect(within(below).getByText('Por debajo del plan')).toBeInTheDocument()
    expect(within(below).getByText('-$500.00').closest('td')).toHaveClass('is-pending')
    expect(screen.getByText('Salidas mayores que ingresos')).toBeInTheDocument()
    expect(screen.queryByRole('rowheader', { name: 'Saldo al cierre' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Comparativo mensual: planeado contra real' })).toHaveAttribute('tabindex', '0')
  })
})
