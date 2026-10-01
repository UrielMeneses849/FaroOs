import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { useState } from 'react'
import { EmptyState } from '../../components/common'
import { formatMxn } from '../../services/financeService'

export interface ExpenseCategoryDatum { name: string; value: number }

const categoryColors = ['#315f9e', '#2d7659', '#9a742f', '#a94952', '#5d5897', '#2d7184', '#747e89']

export function ExpenseCategoryDonut({ data, emptyDescription = 'No hay gastos completados en este periodo.', variant = 'default' }: { data: ExpenseCategoryDatum[]; emptyDescription?: string; variant?: 'default' | 'dashboard' }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const rows = [...data].sort((a, b) => b.value - a.value)
  const total = rows.reduce((sum, item) => sum + item.value, 0)
  if (!rows.length) return <EmptyState title="Sin gastos" description={emptyDescription} />
  // The dashboard card is intentionally compact. The full Finance summary
  // keeps every category and gives its legend its own scrollable area.
  // Dashboard and Finance intentionally share the same source of truth: no
  // aggregation into “Otros”, since hiding a category makes the hover detail
  // misleading precisely when a person is investigating their spending.
  const chartRows = rows
  const legendRows = chartRows
  const active = activeIndex == null ? undefined : chartRows[activeIndex]

  // In the dashboard the card itself defines the available canvas. Percentage
  // radii let the chart grow with that canvas instead of leaving a fixed-size
  // donut floating in a taller panel.
  const innerRadius = variant === 'dashboard' ? '54%' : 58
  const outerRadius = variant === 'dashboard' ? '88%' : 82

  return <div className={`expense-category-chart expense-category-chart--${variant}`}>
    <div className="expense-category-chart__donut">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart accessibilityLayer>
          <Pie data={chartRows} dataKey="value" nameKey="name" innerRadius={innerRadius} outerRadius={outerRadius} paddingAngle={2} onMouseEnter={(_, index) => setActiveIndex(index)} onMouseLeave={() => setActiveIndex(null)}>
            {chartRows.map((item, index) => <Cell key={item.name} fill={categoryColors[index % categoryColors.length]} />)}
          </Pie>
          <Tooltip formatter={(value) => formatMxn(Number(value))} wrapperStyle={{ zIndex: 5 }} contentStyle={{ background: '#111114', border: '1px solid #303038', borderRadius: 8 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="expense-category-chart__total"><span>Total gastado</span><strong>{formatMxn(total)}</strong>{active && <small>{active.name} · {(active.value / total * 100).toFixed(1)}%</small>}</div>
    </div>
    <div className="expense-category-chart__legend" tabIndex={0} aria-label="Desglose de gastos por categoría">
      {legendRows.map((item, index) => <div key={item.name} title={item.name}>
        <i style={{ background: categoryColors[index % categoryColors.length] }} />
        <span>{item.name}</span>
        <strong>{total ? `${(item.value / total * 100).toFixed(1)}%` : '0%'}</strong>
        <small>{formatMxn(item.value)}</small>
      </div>)}
    </div>
  </div>
}
