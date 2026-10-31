import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ArrowDownLeft, ArrowUpRight, ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import { formatMxn } from '../../services/financeService'
import './finance-overview-analysis.css'

export interface FinanceOverviewAnalysisProps {
  flow: { incomeCents: number; expenseCents: number; netCents: number }
  categories: { name: string; value: number }[]
  month: Date
  refundCents?: number
}

const percent = (ratio: number) => new Intl.NumberFormat('es-MX', { style: 'percent', maximumFractionDigits: 1 }).format(ratio)
const finite = (value: number) => Number.isFinite(value) ? value : 0

export function FinanceOverviewAnalysis({ flow, categories, month, refundCents = 0 }: FinanceOverviewAnalysisProps) {
  const [expanded, setExpanded] = useState(false)
  const remainderId = useId()
  const income = finite(flow.incomeCents)
  const expense = finite(flow.expenseCents)
  const net = finite(flow.netCents)
  const refunds = Math.max(0, finite(refundCents))
  const scale = Math.max(Math.abs(income), Math.abs(expense), 1)
  const hasFlow = income !== 0 || expense !== 0
  const hasSignedAdjustment = income < 0 || expense < 0
  const items = categories.filter(item => Number.isFinite(item.value) && item.value > 0)
    .map((item, index) => ({ ...item, rowKey: `${item.name}:${index}` }))
    .sort((a, b) => b.value - a.value)
  const total = items.reduce((sum, item) => sum + item.value, 0)
  const primary = items.slice(0, 5)
  const remaining = items.slice(5)
  const refundCopy = refunds > total && expense === 0
    ? `Hay ${formatMxn(refunds)} en reembolsos; el gasto neto del flujo se limita a ${formatMxn(0)}. Las categorías muestran los importes originales.`
    : `El gasto del flujo descuenta ${formatMxn(refunds)} en reembolsos; las categorías muestran importes originales.`
  const status = !hasFlow ? 'Sin movimientos' : net < 0 ? 'Déficit' : net > 0 ? 'Excedente' : 'En equilibrio'
  const resultCopy = !hasFlow
    ? 'Aún no hay ingresos ni gastos realizados en este mes.'
    : hasSignedAdjustment
      ? 'El resultado conserva los ajustes registrados. Las barras comparan la magnitud de cada importe.'
      : income === 0
        ? `Hay ${formatMxn(expense)} de gastos y ningún ingreso cobrado en este periodo.`
        : net < 0
          ? `Los gastos superan a los ingresos en ${formatMxn(Math.abs(net))}.`
          : net > 0
            ? `Los ingresos superan a los gastos en ${formatMxn(net)}.`
            : 'Los ingresos y los gastos tienen el mismo importe.'

  const categoryRows = (rows: typeof items) => <ol className="finance-overview-analysis__categories" role="list">
    {rows.map(item => <li key={item.rowKey}>
      <div className="finance-overview-analysis__category-label"><span>{item.name || 'Sin categoría'}</span><strong>{formatMxn(item.value)}<small>{percent(item.value / total)}</small></strong></div>
      <div className="finance-overview-analysis__track" aria-hidden="true"><span style={{ width: `${item.value / total * 100}%` }} /></div>
    </li>)}
  </ol>

  return <div className="finance-overview-analysis">
    <article className="finance-overview-analysis__card finance-overview-analysis__flow" aria-label="Flujo del mes">
      <header className="finance-overview-analysis__head"><span className="finance-overview-analysis__eyebrow">{format(month, 'MMMM yyyy', { locale: es })} · realizado</span><h2>Flujo del mes</h2><p>Ingresos cobrados frente a gastos pagados.</p></header>
      <div className="finance-overview-analysis__body">
        <dl className="finance-overview-analysis__flows">
          <div className="finance-overview-analysis__flow-row is-income"><div><dt><ArrowDownLeft size={16} aria-hidden="true" />Ingresos</dt><dd>{formatMxn(income)}</dd></div><div className="finance-overview-analysis__track" aria-hidden="true"><span style={{ width: `${Math.abs(income) / scale * 100}%` }} /></div></div>
          <div className="finance-overview-analysis__flow-row is-expense"><div><dt><ArrowUpRight size={16} aria-hidden="true" />Gastos</dt><dd>{formatMxn(expense)}</dd></div><div className="finance-overview-analysis__track" aria-hidden="true"><span style={{ width: `${Math.abs(expense) / scale * 100}%` }} /></div></div>
        </dl>
        <div className={`finance-overview-analysis__result${net < 0 ? ' is-negative' : net > 0 ? ' is-positive' : ''}`}><div><span>Resultado neto</span><strong>{formatMxn(net)}</strong></div><span className="finance-overview-analysis__status">{status}</span></div>
        <p className="finance-overview-analysis__note">{resultCopy}</p>
      </div>
      <footer>Ambas barras usan la misma escala. El flujo no incluye transferencias entre cuentas.</footer>
    </article>

    <article className="finance-overview-analysis__card finance-overview-analysis__distribution" aria-label="En qué se fue">
      <header className="finance-overview-analysis__head"><span className="finance-overview-analysis__eyebrow">Distribución del gasto</span><h2>En qué se fue</h2><p>Cada porcentaje se calcula sobre el total de categorías.</p></header>
      {items.length ? <div className="finance-overview-analysis__body">
        <div className="finance-overview-analysis__category-total"><span>Gasto clasificado<strong>{formatMxn(total)}</strong></span><small>{items.length} {items.length === 1 ? 'categoría' : 'categorías'}</small></div>
        {categoryRows(primary)}
        {remaining.length > 0 && <>
          <button className="finance-overview-analysis__expand" type="button" aria-expanded={expanded} aria-controls={remainderId} onClick={() => setExpanded(value => !value)}><span>{expanded ? 'Mostrar sólo las 5 principales' : 'Ver todas las categorías'}<small>{expanded ? `${items.length} en total` : `${remaining.length} más`}</small></span><ChevronDown size={17} aria-hidden="true" /></button>
          <div id={remainderId} hidden={!expanded} className="finance-overview-analysis__remainder">{categoryRows(remaining)}</div>
        </>}
      </div> : <div className="finance-overview-analysis__empty"><strong>Sin gastos por categoría</strong><p>Los gastos realizados aparecerán aquí cuando tengan una categoría.</p></div>}
      <footer>{refunds > 0 ? <>Importes antes de reembolsos. {refundCopy}</> : 'Importes realizados del mes seleccionado.'}{remaining.length > 0 && !expanded ? ' Se muestran las 5 categorías con mayor gasto.' : ''}</footer>
    </article>
  </div>
}
