import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { EmptyState } from '../../components/common'
import { formatMxn } from '../../services/financeService'

export interface ExpenseCategoryDatum { name: string; value: number }

const categoryColors = ['#1558e8', '#159151', '#e9ad2f', '#ff3e48', '#5450db', '#1f9ddd', '#9aa1aa']

export function ExpenseCategoryDonut({ data, emptyDescription = 'No hay gastos completados en este periodo.', variant = 'default' }: { data: ExpenseCategoryDatum[]; emptyDescription?: string; variant?: 'default' | 'dashboard' }) {
  const rows = [...data].sort((a, b) => b.value - a.value)
  const total = rows.reduce((sum, item) => sum + item.value, 0)
  if (!rows.length) return <EmptyState title="Sin gastos" description={emptyDescription} />
  const chartRows = variant === 'default' && rows.length > 7
    ? [...rows.slice(0, 6), { name: 'Otros', value: rows.slice(6).reduce((sum, item) => sum + item.value, 0) }]
    : rows
  const legendRows = chartRows.slice(0, variant === 'dashboard' ? 6 : 7)

  const innerRadius = variant === 'dashboard' ? 64 : 58
  const outerRadius = variant === 'dashboard' ? 94 : 82

  return <div className={`expense-category-chart expense-category-chart--${variant}`}>
    <div className="expense-category-chart__donut">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart accessibilityLayer>
          <Pie data={chartRows} dataKey="value" nameKey="name" innerRadius={innerRadius} outerRadius={outerRadius} paddingAngle={2}>
            {chartRows.map((item, index) => <Cell key={item.name} fill={categoryColors[index % categoryColors.length]} />)}
          </Pie>
          <Tooltip formatter={(value) => formatMxn(Number(value))} wrapperStyle={{ zIndex: 5 }} contentStyle={{ background: '#111114', border: '1px solid #303038', borderRadius: 8 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="expense-category-chart__total"><span>Total gastado</span><strong>{formatMxn(total)}</strong></div>
    </div>
    <div className="expense-category-chart__legend">
      {legendRows.map((item, index) => <div key={item.name} title={item.name}>
        <i style={{ background: categoryColors[index % categoryColors.length] }} />
        <span>{item.name}</span>
        <strong>{total ? `${(item.value / total * 100).toFixed(1)}%` : '0%'}</strong>
        <small>{formatMxn(item.value)}</small>
      </div>)}
    </div>
  </div>
}
