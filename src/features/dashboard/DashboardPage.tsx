import { format, subDays } from 'date-fns'
import { es } from 'date-fns/locale'
import { Activity, ArrowUpRight, Scale, Utensils } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { Button, EmptyState } from '../../components/common'
import { PageHeader } from '../../components/layout'
import { useCalendarData } from '../../hooks/useCalendarData'
import { useFinance } from '../../hooks/useFinance'
import { usePageCapture } from '../../hooks/usePageCapture'
import { useWorkspaces } from '../../hooks/useWorkspaces'
import { localDate, timestampToLocalParts } from '../../lib/calendarDates'
import { formatMxn } from '../../services/financeService'
import { useFaroStore } from '../../store'

export function DashboardPage() {
  const { capture } = usePageCapture()
  const { data: workspaces } = useWorkspaces()
  const { data: finance } = useFinance()
  const { data: calendar, error: calendarError, refresh: refreshCalendar } = useCalendarData()
  const tasks = useFaroStore((state) => state.tasks)
  const projects = useFaroStore((state) => state.projects)
  const storedHealthLogs = useFaroStore((state) => state.healthLogs)
  const healthLogs = storedHealthLogs.filter((item) => !/^health-\d+$/.test(item.id))
  const today = localDate()
  const healthCutoff = format(subDays(new Date(`${today}T12:00:00`), 29), 'yyyy-MM-dd')
  const upcoming = calendar.items.filter((item) => !item.allDay && item.start >= new Date().toISOString())
    .sort((a, b) => a.start.localeCompare(b.start)).slice(0, 5)
  const spentToday = finance.transactions.filter((item) => item.transactionDate === today && item.status === 'completed'
    && (item.type === 'expense' || item.type === 'debt_payment'))
    .reduce((sum, item) => sum + item.amountCents, 0)
  const activeProjects = projects.filter((project) => project.status === 'active' && !project.archivedAt)
  const workspaceRows = workspaces.filter((workspace) => workspace.isActive).map((workspace) => {
    const scoped = tasks.filter((task) => task.workspaceId === workspace.id && task.status !== 'done' && !task.archivedAt)
    return { workspace, pending: scoped.length, doing: scoped.filter((task) => task.status === 'doing').length, overdue: scoped.filter((task) => task.dueDate && task.dueDate < today).length }
  })
  const riskyProjects = activeProjects.filter((project) => project.endDate && project.endDate < today)
  const expenseByCategory = finance.categories.map((category) => ({
    name: category.name,
    value: finance.transactions.filter((item) => item.categoryId === category.id
      && item.transactionDate.startsWith(today.slice(0, 7)) && item.status === 'completed'
      && (item.type === 'expense' || item.type === 'debt_payment'))
      .reduce((sum, item) => sum + item.amountCents, 0),
  })).filter((item) => item.value > 0).sort((a, b) => b.value - a.value)
  const expenseTotal = expenseByCategory.reduce((sum, item) => sum + item.value, 0)
  const latestHealth = [...healthLogs].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]
  const recentHealth = healthLogs.filter((item) => item.occurredAt.slice(0, 10) >= healthCutoff)

  return <div className="page dashboard-page dashboard-ops">
    <PageHeader eyebrow={format(new Date(), "EEEE, d 'de' MMMM", { locale: es })} title="Dashboard" description="Lo importante, sin repetir todo FARO." onCapture={capture} />
    <div className="dashboard-ops__grid">
      <section className="ops-panel ops-calendar"><PanelHead eyebrow="Calendario" title="Próximos compromisos" to="/calendar" label="Abrir calendario" />{calendarError ? <EmptyState title="Calendario no disponible" description={calendarError} action={<Button onClick={refreshCalendar}>Reintentar</Button>} /> : <div className="ops-list">{upcoming.map((item) => <article key={item.id}><time>{timestampToLocalParts(item.start).time}</time><strong>{item.title}</strong><span>{workspaces.find((workspace) => workspace.id === item.workspaceId)?.name}</span></article>)}{!upcoming.length && <p>Sin compromisos próximos.</p>}</div>}</section>
      <section className="ops-panel ops-execution"><PanelHead eyebrow="Ejecución" title="Carga por workspace" to="/backlog" label="Abrir Backlog" /><div className="ops-table"><header><span>Workspace</span><span>Pendientes</span><span>En curso</span><span>Vencidas</span></header>{workspaceRows.map(({ workspace, pending, doing, overdue: late }) => <div key={workspace.id}><strong><i style={{ background: workspace.color }} />{workspace.name}</strong><span>{pending}</span><span>{doing}</span><span>{late}</span></div>)}</div><small>{activeProjects.length} proyectos activos · {riskyProjects.length} en riesgo</small></section>
      <section className="ops-panel ops-finance"><PanelHead eyebrow="Finanzas" title="Gasto por categoría" to="/finance" label="Abrir Finanzas" /><div className="ops-finance__body"><div className="ops-finance__donut">{expenseByCategory.length ? <ResponsiveContainer width="100%" height="100%"><PieChart accessibilityLayer><Pie data={expenseByCategory} dataKey="value" nameKey="name" innerRadius={58} outerRadius={82} paddingAngle={2}>{expenseByCategory.map((item, index) => <Cell key={item.name} fill={['#2457ff', '#35c78a', '#f4b740', '#a970ff', '#f05252', '#2ab7ca'][index % 6]} />)}</Pie><Tooltip formatter={(value) => formatMxn(Number(value))} contentStyle={{ background: '#111114', border: '1px solid #303038' }} /></PieChart></ResponsiveContainer> : <EmptyState title="Sin gastos este mes" description="La distribución aparecerá al registrar gastos." />} {expenseByCategory.length > 0 && <div><span>Total gastado</span><strong>{formatMxn(expenseTotal)}</strong></div>}</div><div className="ops-finance__legend"><aside><span>Gastado hoy</span><strong>{formatMxn(spentToday)}</strong></aside>{expenseByCategory.slice(0, 6).map((item, index) => <div key={item.name}><i style={{ background: ['#2457ff', '#35c78a', '#f4b740', '#a970ff', '#f05252', '#2ab7ca'][index % 6] }} /><span>{item.name}</span><strong>{expenseTotal ? `${(item.value / expenseTotal * 100).toFixed(1)}%` : '0%'}</strong></div>)}</div></div></section>
      <section className="ops-panel ops-health"><PanelHead eyebrow="Salud" title="Tu tendencia" to="/health" label="Abrir Salud" /><div className="ops-health__summary"><div><Scale /><span>Último peso</span><strong>{latestHealth?.weightKg ? `${latestHealth.weightKg} kg` : '—'}</strong></div><div><Activity /><span>Entrené</span><strong>{recentHealth.filter((item) => (item.trainingMinutes ?? 0) > 0).length} días</strong></div><div><Utensils /><span>Comí bien</span><strong>{recentHealth.filter((item) => item.foodQuality === 'good').length} días</strong></div></div><div className="ops-health__spark">{recentHealth.filter((item) => item.weightKg).slice(-12).map((item) => <i key={item.id} style={{ height: `${Math.max(18, Math.min(100, ((item.weightKg ?? 0) / Math.max(...recentHealth.map((log) => log.weightKg ?? 1))) * 100))}%` }} title={`${item.weightKg} kg`} />)}</div></section>
    </div>
  </div>
}

function PanelHead({ eyebrow, title, to, label }: { eyebrow: string; title: string; to?: string; label?: string }) {
  return <header className="ops-panel__head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{to && <Link to={to}>{label}<ArrowUpRight size={12} /></Link>}</header>
}
