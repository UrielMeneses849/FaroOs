import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { EmptyState } from '../../components/common'
import { formatMxn } from '../../services/financeService'

export interface ExpenseCategoryDatum { name: string; value: number }

const categoryColors = ['#2457ff', '#35c78a', '#f4b740', '#a970ff', '#f05252', '#2ab7ca']

export function ExpenseCategoryDonut({ data, emptyDescription = 'No hay gastos completados en este periodo.' }: { data: ExpenseCategoryDatum[]; emptyDescription?: string }) {
  const rows = [...data].sort((a, b) => b.value - a.value)
  const total = rows.reduce((sum, item) => sum + item.value, 0)
  if (!rows.length) return <EmptyState title="Sin gastos" description={emptyDescription} />

  return <div className="expense-category-chart">
    <div className="expense-category-chart__donut">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart accessibilityLayer>
          <Pie data={rows} dataKey="value" nameKey="name" innerRadius={58} outerRadius={82} paddingAngle={2}>
            {rows.map((item, index) => <Cell key={item.name} fill={categoryColors[index % categoryColors.length]} />)}
          </Pie>
          <Tooltip formatter={(value) => formatMxn(Number(value))} wrapperStyle={{ zIndex: 5 }} contentStyle={{ background: '#111114', border: '1px solid #303038', borderRadius: 8 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="expense-category-chart__total"><span>Total gastado</span><strong>{formatMxn(total)}</strong></div>
    </div>
    <div className="expense-category-chart__legend">
      {rows.slice(0, 6).map((item, index) => <div key={item.name} title={item.name}>
        <i style={{ background: categoryColors[index % categoryColors.length] }} />
        <span>{item.name}</span>
        <strong>{total ? `${(item.value / total * 100).toFixed(1)}%` : '0%'}</strong>
        <small>{formatMxn(item.value)}</small>
      </div>)}
    </div>
  </div>
}
