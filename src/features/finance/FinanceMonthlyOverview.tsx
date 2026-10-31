import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ArrowDownLeft, ArrowUpRight, ChartNoAxesCombined, PiggyBank } from 'lucide-react'
import { formatMxn } from '../../services/financeService'
import './finance-monthly-overview.css'

interface MonthlyComparisonRow {
  label: string
  planned: number
  actual: number
  difference: number
}

interface FinanceMonthlyOverviewProps {
  month: Date
  rows: MonthlyComparisonRow[]
  incomeCents: number
  expenseCents: number
  savingsRate: number
  hasRefunds?: boolean
}

export function FinanceMonthlyOverview({ month, rows, incomeCents, expenseCents, savingsRate, hasRefunds = false }: FinanceMonthlyOverviewProps) {
  const netCents = incomeCents - expenseCents
  return <section className="finance-monthly-overview" aria-labelledby="finance-monthly-heading">
    <header>
      <div><span className="finance-monthly-overview__eyebrow">Previsión mensual</span><h2 id="finance-monthly-heading">El mes, en números</h2></div>
      <span className="finance-monthly-overview__period">{format(month, 'MMMM yyyy', { locale: es })}</span>
    </header>
    <dl className="finance-monthly-overview__forecasts" aria-label="Previsión del periodo">
      <div className="is-income"><ArrowUpRight size={18} aria-hidden="true" /><dt>Ingresos proyectados</dt><dd>{formatMxn(incomeCents)}</dd><small>Cobrados + pendientes</small></div>
      <div className="is-expense"><ArrowDownLeft size={18} aria-hidden="true" /><dt>Gastos proyectados</dt><dd>{formatMxn(expenseCents)}</dd><small>Pagados, compromisos y reservas</small></div>
      <div className={netCents < 0 ? 'is-deficit' : 'is-net'}><ChartNoAxesCombined size={18} aria-hidden="true" /><dt>Flujo neto proyectado</dt><dd>{formatMxn(netCents)}</dd><small>{netCents < 0 ? 'Salidas mayores que ingresos' : netCents > 0 ? 'Ingresos mayores que salidas' : 'Ingresos y salidas en equilibrio'}</small></div>
      <div className="is-savings"><PiggyBank size={18} aria-hidden="true" /><dt>Tasa de ahorro realizada</dt><dd>{savingsRate.toFixed(1)}<span>%</span></dd><small>Sobre ingresos cobrados</small></div>
    </dl>
    <div className="finance-monthly-overview__comparison">
      <h3>Planeado contra real</h3>
      <div className="finance-monthly-overview__table-wrap" role="region" aria-label="Comparativo mensual: planeado contra real" tabIndex={0}>
        <table>
          <caption className="sr-only">Comparativo financiero de {format(month, 'MMMM yyyy', { locale: es })}. La diferencia es el importe real menos el planeado.</caption>
          <thead><tr><th scope="col">Concepto</th><th scope="col">Planeado</th><th scope="col">Real</th><th scope="col">Diferencia</th></tr></thead>
          <tbody>{rows.filter(row => row.label !== 'Saldo al cierre').map(row => {
            const isExpense = row.label.startsWith('Gastos')
            // A lower expense can still be unpaid; do not label it as savings.
            const tone = row.difference === 0 ? 'is-even' : isExpense ? row.difference > 0 ? 'is-over' : 'is-pending' : row.difference > 0 ? 'is-favorable' : 'is-pending'
            return <tr key={row.label}><th scope="row">{row.label}</th><td>{formatMxn(row.planned)}</td><td>{formatMxn(row.actual)}</td><td className={tone}><span>{row.difference > 0 ? '+' : ''}{formatMxn(row.difference)}</span>{row.difference !== 0 && <small>{row.difference > 0 ? 'Sobre lo previsto' : 'Por debajo del plan'}</small>}</td></tr>
          })}</tbody>
        </table>
      </div>
      <p>La diferencia es real menos planeado. Los gastos variables se comparan con tus presupuestos.{hasRefunds && ' Las proyecciones incluyen reembolsos como entradas; el flujo realizado los descuenta del gasto.'}</p>
    </div>
  </section>
}
