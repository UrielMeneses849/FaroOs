import { addMonths, format, parseISO, startOfMonth } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarRange, ShieldAlert, WalletCards } from 'lucide-react'
import { useMemo } from 'react'
import { financeLiquidityProjection } from '../../services/financeLiquidityProjection'
import { financeProjectionGuide, type FinanceProjectionGuideMonth } from '../../services/financeProjectionGuide'
import { canonicalFinanceBudgetGroups, formatMxn } from '../../services/financeService'
import type { FinanceData } from './financeTypes'

interface FinanceProjectionGuideProps {
  data: FinanceData
  selectedMonth: Date
  availableTodayCents: number
}

const monthLabel = (date: string, pattern = 'MMMM') => format(parseISO(date), pattern, { locale: es })

const naturalList = (items: string[]) => items.length < 2
  ? items[0] ?? ''
  : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`

const statusLabel = (status: FinanceProjectionGuideMonth['status']) => {
  if (status === 'stable') return 'Estable'
  if (status === 'moderation') return 'Atención'
  return 'Crítico'
}

function planningYear(reference: Date, selectedMonth: Date) {
  const defaultYear = reference.getMonth() <= 5 ? reference.getFullYear() : reference.getFullYear() + 1
  const selectedIsFutureFirstSemester = selectedMonth.getMonth() <= 5
    && startOfMonth(selectedMonth) >= startOfMonth(reference)
  return selectedIsFutureFirstSemester ? selectedMonth.getFullYear() : defaultYear
}

function recommendationForMonth(month: FinanceProjectionGuideMonth, guide: NonNullable<ReturnType<typeof financeProjectionGuide>>) {
  const minimumDate = monthLabel(month.minimumDate, "d 'de' MMMM")
  if (month.bufferGapCents > 0) return `Refuerza ${formatMxn(month.bufferGapCents)} antes del ${minimumDate}.`
  if (month.status === 'moderation') return `Protege el colchón y evita sumar gastos flexibles antes del ${minimumDate}.`
  if (month.periodStart < guide.worstMonth.periodStart && guide.suggestedMonthlyReserveCents > 0) {
    return `Aparta ${formatMxn(guide.suggestedMonthlyReserveCents)} para llegar preparado a ${monthLabel(guide.worstMonth.periodStart)}.`
  }
  if (month.netChangeCents < 0) return 'Mes controlado, pero termina por debajo de como inicia; conserva el excedente.'
  return 'Mes con margen: úsalo para reconstruir o adelantar tu fondo preventivo.'
}

export function FinanceProjectionGuide({ data, selectedMonth, availableTodayCents }: FinanceProjectionGuideProps) {
  const referenceDate = useMemo(() => new Date(), [])
  const year = planningYear(referenceDate, selectedMonth)
  const categoryIds = useMemo(() => [...new Set(canonicalFinanceBudgetGroups(data)
    .filter((group) => !group.isPersonal)
    .map((group) => group.budget.categoryId))], [data])
  const projections = useMemo(() => Array.from({ length: 6 }, (_, index) => financeLiquidityProjection({
    data,
    month: addMonths(new Date(year, 0, 1), index),
    currentAvailableBalanceCents: availableTodayCents,
    minimumOperatingBufferCents: data.liquidityPreference.minimumOperatingBufferCents,
    referenceDate,
    includePersonalBudgetReservations: true,
    includedBudgetCategoryIds: categoryIds,
    carryIncludePersonalBudgetReservations: true,
    carryIncludedBudgetCategoryIds: categoryIds,
  })), [availableTodayCents, categoryIds, data, referenceDate, year])
  const guide = useMemo(() => financeProjectionGuide(
    projections,
    data.liquidityPreference.minimumOperatingBufferCents,
    referenceDate,
  ), [data.liquidityPreference.minimumOperatingBufferCents, projections, referenceDate])

  if (!guide) return null
  const worstLabel = monthLabel(guide.worstMonth.periodStart)
  const criticalMonthLabels = guide.months
    .filter((month) => month.status === 'critical')
    .map((month) => monthLabel(month.periodStart))
  const deadline = monthLabel(guide.worstMonth.minimumDate, "d 'de' MMMM")
  const isCovered = guide.protectionTargetCents === 0

  return <section className="liquidity-guide" aria-label={`Guía financiera del primer semestre de ${year}`}>
    <header className="liquidity-guide__head">
      <div>
        <span className="eyebrow">Plan preventivo · enero a junio {year}</span>
        <h3>Ruta de liquidez mensual</h3>
        <p>{isCovered
          ? 'Tu plan actual conserva el colchón durante todo el semestre. Mantén los gastos y fechas registrados al día.'
          : `Tus meses críticos son ${naturalList(criticalMonthLabels)}; la mayor presión está en ${worstLabel}. La meta evita que tu saldo baje del colchón configurado.`}</p>
      </div>
      <span className={`liquidity-guide__signal${isCovered ? ' is-covered' : ''}`}><ShieldAlert size={15} />{isCovered ? 'Semestre cubierto' : `Prioridad: ${worstLabel}`}</span>
    </header>

    <div className="liquidity-guide__summary">
      <article><CalendarRange size={17} /><span>Mes más delicado</span><strong>{worstLabel}</strong><small>Mínimo {formatMxn(guide.worstMonth.minimumBalanceCents)} · {deadline}</small></article>
      <article><ShieldAlert size={17} /><span>Meta preventiva</span><strong>{formatMxn(guide.protectionTargetCents)}</strong><small>{isCovered ? 'No necesitas refuerzo adicional' : `Extra para respetar tu colchón de ${formatMxn(data.liquidityPreference.minimumOperatingBufferCents)}`}</small></article>
      <article><WalletCards size={17} /><span>Apartado mensual sugerido</span><strong>{formatMxn(guide.suggestedMonthlyReserveCents)}</strong><small>{isCovered ? 'Sigue con tu plan actual' : `${guide.monthsToWorstPoint} meses para construir la protección`}</small></article>
    </div>

    <div className="liquidity-guide__months">
      <div className="liquidity-guide__month-head"><span>Mes</span><span>Punto mínimo</span><span>Cierre</span><span>Recomendación</span></div>
      {guide.months.map((month) => <article key={month.periodStart} className={`liquidity-guide__month liquidity-guide__month--${month.status}${month.attentionRank === 1 ? ' is-priority' : ''}`}>
        <div><strong>{monthLabel(month.periodStart)}</strong><small>{month.attentionRank === 1 ? 'Mayor atención' : statusLabel(month.status)}</small></div>
        <b>{formatMxn(month.minimumBalanceCents)}<small>{monthLabel(month.minimumDate, 'd MMM')}</small></b>
        <b>{formatMxn(month.closingBalanceCents)}<small className={month.netChangeCents >= 0 ? 'positive' : 'negative'}>{month.netChangeCents >= 0 ? '+' : ''}{formatMxn(month.netChangeCents)} en el mes</small></b>
        <p>{recommendationForMonth(month, guide)}</p>
      </article>)}
    </div>
    <footer>Guía calculada con movimientos, recurrencias y todos los presupuestos activos. Es una previsión: actualízala cuando cambie un monto o una fecha.</footer>
  </section>
}
