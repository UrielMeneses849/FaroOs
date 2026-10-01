import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { jsPDF } from 'jspdf'
import type { FinanceMetrics } from '../features/finance/financeTypes'

type SummaryRow = { label: string; planned: number; actual: number; difference: number }
type ReportExpense = { date: string; amountCents: number; description: string; category?: string }

export interface FinanceReportPdfInput {
  month: Date
  metrics: FinanceMetrics
  summary: SummaryRow[]
  categories: Array<{ name: string; value: number }>
  incomeCents: number
  expenseCents: number
  pendingExpenseCents: number
  completedExpenses?: ReportExpense[]
}

const money = (cents: number) => new Intl.NumberFormat('es-MX', {
  style: 'currency', currency: 'MXN', maximumFractionDigits: 2,
}).format(cents / 100)

const ink = '#F4F7FB'
const muted = '#9AA8B8'
const subtle = '#6F8195'
const navy = '#08111C'
const panel = '#0D1824'
const panelAlt = '#0A1420'
const line = '#233448'
const blue = '#2D90FF'
const green = '#24C985'
const red = '#FF6670'
const amber = '#F1B95B'
const purple = '#B084FF'

function text(doc: jsPDF, value: string, x: number, y: number, size: number, color = ink, weight: 'normal' | 'bold' = 'normal', align: 'left' | 'center' | 'right' = 'left') {
  doc.setFont('helvetica', weight)
  doc.setFontSize(size)
  doc.setTextColor(color)
  doc.text(value, x, y, { align })
}

function textLines(doc: jsPDF, value: string, x: number, y: number, width: number, size: number, color = muted, weight: 'normal' | 'bold' = 'normal', leading = 1.38) {
  const lines = doc.splitTextToSize(value, width) as string[]
  const lineHeight = size * leading
  lines.forEach((lineValue, index) => text(doc, lineValue, x, y + index * lineHeight, size, color, weight))
  return lines.length * lineHeight
}

function card(doc: jsPDF, x: number, y: number, width: number, height: number, accent: string, background = panel) {
  doc.setFillColor(background)
  doc.setDrawColor(line)
  doc.roundedRect(x, y, width, height, 9, 9, 'FD')
  doc.setFillColor(accent)
  doc.roundedRect(x, y, 3, height, 2, 2, 'F')
}

function pageBackground(doc: jsPDF, pageLabel: string) {
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  doc.setFillColor(navy)
  doc.rect(0, 0, width, height, 'F')
  doc.setFillColor('#0B1D31')
  doc.circle(width - 42, 34, 54, 'F')
  doc.setFillColor('#123B64')
  doc.circle(width - 16, 48, 32, 'F')
  text(doc, 'FARO FINANZAS', 40, 42, 8, blue, 'bold')
  text(doc, pageLabel.toUpperCase(), width - 40, 42, 7, subtle, 'bold', 'right')
}

function pageFooter(doc: jsPDF, page: number, source?: string) {
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  doc.setDrawColor(line)
  doc.line(40, height - 36, width - 40, height - 36)
  text(doc, source ?? 'FARO OS - INFORME PRIVADO', 40, height - 21, 7, muted, 'bold')
  text(doc, `Pagina ${page}`, width - 40, height - 21, 7, muted, 'bold', 'right')
}

function sectionTitle(doc: jsPDF, eyebrow: string, title: string, y: number) {
  text(doc, eyebrow.toUpperCase(), 40, y, 9, blue, 'bold')
  text(doc, title, 40, y + 24, 19, ink, 'bold')
}

function safeDate(date: string) {
  try { return format(parseISO(date), "d 'de' MMMM", { locale: es }) } catch { return date }
}

function percentage(value: number, total: number) {
  return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0.0%'
}

function decisionPosture(conservativeMargin: number, pendingExpenseCents: number) {
  if (conservativeMargin < 0) return {
    label: 'PROTEGE LIQUIDEZ', accent: red,
    body: 'El disponible no cubre todos los compromisos pendientes. No apartes dinero para inversión hasta ordenar fechas, montos y prioridades.',
  }
  if (pendingExpenseCents > 0) return {
    label: 'MARGEN A VALIDAR', accent: amber,
    body: 'Hay margen después de compromisos capturados. Verifica gastos esenciales no registrados antes de destinarlo a metas o inversión.',
  }
  return {
    label: 'CAJA SIN PENDIENTES', accent: green,
    body: 'No aparecen gastos pendientes para este mes. Antes de asignar el disponible, confirma renta, tarjetas, impuestos y gastos estacionales.',
  }
}

function investmentStage(conservativeMargin: number, pendingExpenseCents: number) {
  if (conservativeMargin <= 0) return {
    title: 'Etapa actual: ordenar caja', accent: red,
    body: 'Primero recupera holgura: confirma pagos, reduce fugas y evita comprometer dinero de corto plazo.',
  }
  if (pendingExpenseCents > 0) return {
    title: 'Etapa actual: construir reserva', accent: amber,
    body: 'Hay margen, pero todavía existen compromisos. Construye reserva líquida antes de asumir volatilidad.',
  }
  return {
    title: 'Etapa actual: planificar asignación', accent: green,
    body: 'Con la caja del mes cubierta, define metas, plazo y tolerancia al riesgo antes de elegir cualquier instrumento.',
  }
}

function addCoverPage(doc: jsPDF, input: FinanceReportPdfInput, rankedCategories: Array<{ name: string; value: number }>, conservativeMargin: number) {
  const width = doc.internal.pageSize.getWidth()
  const margin = 40
  const reportMonth = format(input.month, "MMMM 'de' yyyy", { locale: es })
  pageBackground(doc, 'Informe de cierre')
  text(doc, 'Informe mensual', margin, 82, 25, ink, 'bold')
  text(doc, reportMonth, margin, 104, 11, muted)
  text(doc, 'Una lectura privada para decidir con caja, contexto y siguientes pasos.', margin, 126, 9, muted)

  const metrics = [
    ['Disponible operativo', input.metrics.availableBalanceCents, blue],
    ['Ingresos realizados', input.incomeCents, green],
    ['Gastos realizados', input.expenseCents, red],
    ['Saldo total al cierre', input.metrics.projectedBalanceCents, purple],
  ] as const
  const gap = 10
  const cardWidth = (width - margin * 2 - gap) / 2
  metrics.forEach(([label, value, accent], index) => {
    const x = margin + (index % 2) * (cardWidth + gap)
    const y = 156 + Math.floor(index / 2) * 78
    card(doc, x, y, cardWidth, 66, accent)
    text(doc, label, x + 14, y + 21, 8, muted, 'bold')
    text(doc, money(value), x + 14, y + 47, 18, accent, 'bold')
  })

  const posture = decisionPosture(conservativeMargin, input.pendingExpenseCents)
  card(doc, margin, 329, width - margin * 2, 92, posture.accent)
  text(doc, 'MARGEN DESPUES DE GASTOS PLANEADOS', margin + 15, 351, 8, muted, 'bold')
  text(doc, money(conservativeMargin), margin + 15, 382, 22, posture.accent, 'bold')
  text(doc, posture.label, margin + 210, 357, 9, posture.accent, 'bold')
  textLines(doc, posture.body, margin + 210, 375, 292, 8.5, muted)

  text(doc, 'PLANEADO CONTRA REAL', margin, 456, 10, blue, 'bold')
  const columns = [margin + 14, 270, 382, 516]
  card(doc, margin, 469, width - margin * 2, 171, blue)
  text(doc, 'CONCEPTO', columns[0], 491, 7, muted, 'bold')
  text(doc, 'PLANEADO', columns[1], 491, 7, muted, 'bold')
  text(doc, 'REAL', columns[2], 491, 7, muted, 'bold')
  text(doc, 'DIF.', columns[3], 491, 7, muted, 'bold', 'right')
  input.summary.slice(0, 5).forEach((row, index) => {
    const y = 517 + index * 23
    doc.setDrawColor('#1C2A39')
    doc.line(margin + 12, y - 12, width - margin - 12, y - 12)
    text(doc, row.label, columns[0], y, 8.5, ink, 'bold')
    text(doc, money(row.planned), columns[1], y, 8.5, muted)
    text(doc, money(row.actual), columns[2], y, 8.5, muted)
    text(doc, money(row.difference), columns[3], y, 8.5, row.difference >= 0 ? green : red, 'bold', 'right')
  })

  text(doc, 'DISTRIBUCION DEL GASTO', margin, 681, 10, blue, 'bold')
  const categoryTotal = rankedCategories.reduce((sum, category) => sum + category.value, 0)
  if (!rankedCategories.length) {
    card(doc, margin, 695, width - margin * 2, 58, blue)
    text(doc, 'No hay gastos completados para este periodo.', margin + 15, 729, 9, muted)
  } else {
    rankedCategories.slice(0, 5).forEach((category, index) => {
      const y = 707 + index * 22
      const ratio = categoryTotal ? category.value / categoryTotal : 0
      text(doc, category.name, margin, y, 8.5, ink, 'bold')
      doc.setFillColor('#1B2A3A')
      doc.roundedRect(margin + 132, y - 8, 250, 7, 3, 3, 'F')
      doc.setFillColor(index === 0 ? blue : index === 1 ? green : index === 2 ? amber : '#6582A5')
      doc.roundedRect(margin + 132, y - 8, Math.max(4, 250 * ratio), 7, 3, 3, 'F')
      text(doc, money(category.value), width - margin, y, 8.5, ink, 'bold', 'right')
    })
  }
  pageFooter(doc, 1)
}

function addDecisionPage(doc: jsPDF, input: FinanceReportPdfInput, rankedCategories: Array<{ name: string; value: number }>, conservativeMargin: number) {
  doc.addPage()
  const width = doc.internal.pageSize.getWidth()
  const margin = 40
  const completed = input.completedExpenses ?? []
  const totalSpent = completed.reduce((sum, item) => sum + item.amountCents, 0) || input.expenseCents
  const categorizedSpend = rankedCategories.reduce((sum, item) => sum + item.value, 0)
  const categoryBasis = categorizedSpend || totalSpent
  const topDays = Object.entries(completed.reduce<Record<string, number>>((byDay, item) => {
    byDay[item.date] = (byDay[item.date] ?? 0) + item.amountCents
    return byDay
  }, {})).sort(([, a], [, b]) => b - a).slice(0, 3)
  const topThreeSpend = rankedCategories.slice(0, 3).reduce((sum, item) => sum + item.value, 0)
  const posture = decisionPosture(conservativeMargin, input.pendingExpenseCents)
  pageBackground(doc, 'Decisiones')
  sectionTitle(doc, 'Lectura accionable', 'Decisiones del periodo', 82)
  text(doc, 'Prioriza proteger caja antes de buscar rendimiento. Este análisis no mueve dinero ni ejecuta operaciones.', margin, 126, 9, muted)

  const quick = [
    ['POSTURA', posture.label, posture.accent],
    ['COMPROMISOS PENDIENTES', money(input.pendingExpenseCents), input.pendingExpenseCents ? amber : green],
    ['TOP 3 DEL GASTO', categoryBasis ? percentage(topThreeSpend, categoryBasis) : 'Sin datos', blue],
  ] as const
  const quickGap = 10
  const quickWidth = (width - margin * 2 - quickGap * 2) / 3
  quick.forEach(([label, value, accent], index) => {
    const x = margin + index * (quickWidth + quickGap)
    card(doc, x, 151, quickWidth, 71, accent)
    text(doc, label, x + 13, 174, 7.2, muted, 'bold')
    text(doc, value, x + 13, 202, index === 0 ? 11 : 15, accent, 'bold')
  })

  const leftWidth = 258
  const rightX = margin + leftWidth + 12
  const rightWidth = width - margin - rightX
  card(doc, margin, 244, leftWidth, 278, blue)
  text(doc, 'GASTO QUE PIDE LUPA', margin + 15, 269, 8, blue, 'bold')
  text(doc, 'Antes de recortar', margin + 15, 292, 15, ink, 'bold')
  textLines(doc, rankedCategories.length
    ? `No recortes en automático. ${rankedCategories[0].name} concentra ${percentage(rankedCategories[0].value, categoryBasis)} de lo categorizado: clasifica cada gasto como esencial, útil o prescindible antes de fijar un tope.`
    : 'Cuando haya gastos registrados, FARO señalará aquí las categorías que merecen una revisión consciente.', margin + 15, 314, leftWidth - 30, 8.5, muted)
  rankedCategories.slice(0, 4).forEach((category, index) => {
    const y = 380 + index * 28
    doc.setDrawColor('#1D2B3A')
    if (index) doc.line(margin + 15, y - 17, margin + leftWidth - 15, y - 17)
    text(doc, String(index + 1).padStart(2, '0'), margin + 15, y, 7, blue, 'bold')
    text(doc, category.name, margin + 38, y, 9, ink, 'bold')
    text(doc, percentage(category.value, categoryBasis), margin + leftWidth - 15, y, 8, muted, 'bold', 'right')
    text(doc, money(category.value), margin + 38, y + 13, 7.5, muted)
  })

  card(doc, rightX, 244, rightWidth, 278, purple)
  text(doc, 'MOMENTOS DE MAYOR GASTO', rightX + 15, 269, 8, purple, 'bold')
  text(doc, 'Días a revisar', rightX + 15, 292, 15, ink, 'bold')
  textLines(doc, topDays.length
    ? 'Estos picos no son un error por sí solos. Sirven para revisar qué evento, compra o pago explica la concentración.'
    : 'Cuando existan movimientos completados, FARO mostrará las fechas con mayor concentración.', rightX + 15, 314, rightWidth - 30, 8.5, muted)
  topDays.forEach(([date, value], index) => {
    const y = 382 + index * 42
    doc.setDrawColor('#1D2B3A')
    if (index) doc.line(rightX + 15, y - 25, rightX + rightWidth - 15, y - 25)
    text(doc, `${String(index + 1).padStart(2, '0')}  ${safeDate(date)}`, rightX + 15, y, 9, ink, 'bold')
    text(doc, index === 0 ? 'Pico de gasto del periodo' : 'Concentración relevante', rightX + 15, y + 14, 7.5, muted)
    text(doc, money(value), rightX + rightWidth - 15, y + 5, 10, index === 0 ? purple : ink, 'bold', 'right')
  })

  card(doc, margin, 544, width - margin * 2, 184, posture.accent, panelAlt)
  text(doc, 'PLAN DE CONTROL - PROXIMOS 7 DIAS', margin + 16, 570, 8, posture.accent, 'bold')
  const commitmentsAction = input.pendingExpenseCents > 0
    ? `Confirma, reprograma o fondea ${money(input.pendingExpenseCents)} de compromisos pendientes antes de separar ahorro o inversión.`
    : 'Confirma que no falten cargos de tarjeta, renta, impuestos o gastos estacionales antes de asignar el disponible.'
  const topCategoryAction = rankedCategories[0]
    ? `Haz una revisión de 15 minutos de ${rankedCategories[0].name}: etiqueta cada movimiento como esencial, útil o prescindible y prueba un límite para el siguiente periodo.`
    : 'Registra los próximos gastos con categoría y fecha para que el siguiente informe detecte patrones reales.'
  const actions = [
    ['01', commitmentsAction],
    ['02', topCategoryAction],
    ['03', 'Para compras no esenciales, aplica una pausa de 24 horas y decide con un presupuesto definido, no con el saldo disponible.'],
  ]
  actions.forEach(([number, body], index) => {
    const y = 602 + index * 36
    text(doc, number, margin + 16, y, 8, posture.accent, 'bold')
    textLines(doc, body, margin + 42, y, width - margin * 2 - 58, 8.5, ink, 'normal', 1.25)
  })
  text(doc, 'Las categorías orientan dónde mirar; no sustituyen tu criterio sobre necesidades, salud, trabajo o familia.', margin + 16, 708, 7.5, subtle)
  pageFooter(doc, 2)
}

function addGrowthPage(doc: jsPDF, input: FinanceReportPdfInput, conservativeMargin: number) {
  doc.addPage()
  const width = doc.internal.pageSize.getWidth()
  const margin = 40
  const stage = investmentStage(conservativeMargin, input.pendingExpenseCents)
  pageBackground(doc, 'Ruta de crecimiento')
  sectionTitle(doc, 'Sin humo, con criterio', 'Tu ruta de crecimiento', 82)
  text(doc, 'Una secuencia para crear riqueza sin poner en juego gastos básicos ni compromisos inmediatos.', margin, 126, 9, muted)

  card(doc, margin, 151, width - margin * 2, 88, stage.accent)
  text(doc, stage.title.toUpperCase(), margin + 15, 174, 8, stage.accent, 'bold')
  textLines(doc, stage.body, margin + 15, 197, width - margin * 2 - 66, 10, ink, 'bold')

  const stepGap = 10
  const stepWidth = (width - margin * 2 - stepGap) / 2
  const steps = [
    ['01', 'Protege', 'Define tus gastos esenciales y construye una reserva líquida. La referencia educativa habitual es cubrir 3 a 6 meses; este informe no puede afirmar que ya la tengas.', blue],
    ['02', 'Ordena', 'Si existe deuda cara o un crédito revolvente, compara CAT, tasa y penalizaciones. Pagar deuda de alto costo puede tener más impacto que perseguir rendimiento.', red],
    ['03', 'Invierte por plazo', 'Para dinero de corto plazo, prioriza disponibilidad y bajo riesgo. Para objetivos de varios años, estudia diversificación, costos, perfil de riesgo y volatilidad.', green],
    ['04', 'Crea opciones', 'Aparta tiempo para aumentar ingreso. Una habilidad, un producto o una automatización vendida con evidencia puede elevar tu capacidad de ahorro.', purple],
  ] as const
  steps.forEach(([number, title, body, accent], index) => {
    const x = margin + (index % 2) * (stepWidth + stepGap)
    const y = 255 + Math.floor(index / 2) * 132
    card(doc, x, y, stepWidth, 118, accent)
    text(doc, number, x + 15, y + 25, 8, accent, 'bold')
    text(doc, title, x + 15, y + 49, 15, ink, 'bold')
    textLines(doc, body, x + 15, y + 70, stepWidth - 30, 8.3, muted)
  })

  card(doc, margin, 531, width - margin * 2, 188, blue, panelAlt)
  text(doc, 'IDEAS TECH PARA VALIDAR INGRESO', margin + 16, 556, 8, blue, 'bold')
  text(doc, 'Experimentos de 2 semanas - no apuestas de inversión', margin + 16, 580, 14, ink, 'bold')
  const experiments = [
    ['Diagnóstico de operaciones con IA', 'Ofrece a una PyME un diagnóstico de ventas, cotización, cobranza o reporteo. Entrega una automatización pequeña y mide horas ahorradas o leads atendidos.'],
    ['Reporte de dirección como servicio', 'Convierte datos dispersos en un tablero de flujo, pendientes y ejecución semanal. Vende claridad operativa antes de construir software completo.'],
    ['Producto interno repetible', 'Detecta un flujo que repites para varios clientes, documenta el proceso y prueba un paquete con precio, alcance y resultado verificable.'],
  ] as const
  experiments.forEach(([title, body], index) => {
    const y = 610 + index * 34
    text(doc, String(index + 1).padStart(2, '0'), margin + 16, y, 7.5, blue, 'bold')
    text(doc, title, margin + 41, y, 8.5, ink, 'bold')
    textLines(doc, body, margin + 41, y + 12, width - margin * 2 - 57, 7.2, muted, 'normal', 1.16)
  })

  text(doc, 'Guardrail: no es una recomendación de valores, cripto, fondos ni crédito. Antes de invertir, verifica institución regulada, comisiones, liquidez y riesgos.', margin, 742, 7.5, muted)
  text(doc, 'Referencias educativas: CONDUSEF y cetesdirecto (instrumentos y riesgos); INEGI ENDUTIH 2025 (contexto digital en México).', margin, 758, 7, subtle)
  pageFooter(doc, 3, 'FARO OS - PLANEACION PRIVADA')
}

/** Creates a private monthly report. It derives observations only from local finance data. */
export function createFinanceReportPdf(input: FinanceReportPdfInput) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true })
  const rankedCategories = [...input.categories].sort((a, b) => b.value - a.value)
  const conservativeMargin = input.metrics.availableBalanceCents - input.pendingExpenseCents
  addCoverPage(doc, input, rankedCategories, conservativeMargin)
  addDecisionPage(doc, input, rankedCategories, conservativeMargin)
  addGrowthPage(doc, input, conservativeMargin)
  return { doc, fileName: `FARO-Finanzas-${format(input.month, 'yyyy-MM')}.pdf` }
}

export function downloadFinanceReportPdf(input: FinanceReportPdfInput) {
  const report = createFinanceReportPdf(input)
  report.doc.save(report.fileName)
}
