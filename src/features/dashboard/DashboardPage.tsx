import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertTriangle, ArrowUpRight, Clock3, Plus } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Button, EmptyState, ProgressBar } from '../../components/common'
import { PageHeader } from '../../components/layout'
import { useCalendarData } from '../../hooks/useCalendarData'
import { useFinance } from '../../hooks/useFinance'
import { usePageCapture } from '../../hooks/usePageCapture'
import { useWorkspaces } from '../../hooks/useWorkspaces'
import { localDate, timestampToLocalParts } from '../../lib/calendarDates'
import { calculateGoalProgress, calculateProjectProgress } from '../../lib/taskMetrics'
import { calculateFinanceMetrics, formatMxn } from '../../services/financeService'
import { useFaroStore } from '../../store'

export function DashboardPage() {
  const { capture } = usePageCapture()
  const { data: workspaces } = useWorkspaces()
  const { data: finance } = useFinance()
  const { data: calendar, error: calendarError, refresh: refreshCalendar } = useCalendarData()
  const tasks = useFaroStore((state) => state.tasks)
  const projects = useFaroStore((state) => state.projects)
  const goals = useFaroStore((state) => state.goals)
  const today = localDate()
  const todayTasks = tasks.filter((task) => task.dueDate === today && !task.archivedAt)
  const overdue = tasks.filter((task) => task.status !== 'done' && !task.archivedAt && Boolean(task.dueDate && task.dueDate < today))
  const pendingToday = todayTasks.filter((task) => task.status !== 'done')
  const completedToday = todayTasks.filter((task) => task.status === 'done')
  const upcoming = calendar.items.filter((item) => !item.allDay && item.start >= new Date().toISOString())
    .sort((a, b) => a.start.localeCompare(b.start)).slice(0, 5)
  const financeMetrics = useMemo(() => calculateFinanceMetrics(finance, new Date()), [finance])
  const spentToday = finance.transactions.filter((item) => item.transactionDate === today && item.status === 'completed'
    && (item.type === 'expense' || item.type === 'debt_payment')).reduce((sum, item) => sum + item.amountCents, 0)
  const activeProjects = projects.filter((project) => project.status === 'active' && !project.archivedAt)
  const activeGoals = goals.filter((goal) => goal.status === 'active' && !goal.archivedAt)
  const workspaceRows = workspaces.filter((workspace) => workspace.isActive).map((workspace) => {
    const scoped = tasks.filter((task) => task.workspaceId === workspace.id && task.status !== 'done' && !task.archivedAt)
    return { workspace, pending: scoped.length, doing: scoped.filter((task) => task.status === 'doing').length, overdue: scoped.filter((task) => task.dueDate && task.dueDate < today).length }
  })
  const riskyProjects = activeProjects.filter((project) => project.endDate && project.endDate < today)
  const budgetAlerts = finance.budgets.filter((budget) => {
    const actual = finance.transactions.filter((item) => item.categoryId === budget.categoryId && item.transactionDate.startsWith(today.slice(0, 7)) && item.status === 'completed' && item.type === 'expense').reduce((sum, item) => sum + item.amountCents, 0)
    return actual > budget.plannedAmountCents
  })
  const goalProgress = activeGoals.length ? Math.round(activeGoals.reduce((sum, goal) => sum + calculateGoalProgress(tasks, projects, goal.id), 0) / activeGoals.length) : 0
  const nextGoal = [...activeGoals].filter((goal) => goal.targetDate).sort((a, b) => a.targetDate!.localeCompare(b.targetDate!))[0]

  return <div className="page dashboard-page dashboard-ops">
    <PageHeader eyebrow={format(new Date(), "EEEE, d 'de' MMMM", { locale: es })} title="Dashboard" description="Lo importante, sin repetir todo FARO." onCapture={capture} />
    <div className="dashboard-ops__grid">
      <section className="ops-panel ops-today"><PanelHead eyebrow="Estado de hoy" title="Tu día" to="/today" label="Ir a Today" /><div className="ops-kpis"><div><span>Pendientes</span><strong>{pendingToday.length}</strong></div><div><span>Completadas</span><strong>{completedToday.length}</strong></div><div><span>Vencidas</span><strong>{overdue.length}</strong></div><div><span>Gastado hoy</span><strong>{formatMxn(spentToday)}</strong></div></div><p><Clock3 size={13} />{upcoming[0] ? `${timestampToLocalParts(upcoming[0].start).time} · ${upcoming[0].title}` : 'Sin compromisos próximos'}</p><Button icon={<Plus size={14} />} onClick={capture}>Crear tarea</Button></section>
      {(overdue.length > 0 || riskyProjects.length > 0 || budgetAlerts.length > 0) && <section className="ops-panel ops-alerts"><PanelHead eyebrow="Requiere atención" title="Alertas reales" /><ul>{overdue.length > 0 && <li><AlertTriangle />{overdue.length} tareas vencidas</li>}{riskyProjects.length > 0 && <li><AlertTriangle />{riskyProjects.length} proyectos vencidos</li>}{budgetAlerts.length > 0 && <li><AlertTriangle />{budgetAlerts.length} presupuestos excedidos</li>}</ul></section>}
      <section className="ops-panel ops-calendar"><PanelHead eyebrow="Calendario" title="Próximos compromisos" to="/calendar" label="Abrir calendario" />{calendarError ? <EmptyState title="Calendario no disponible" description={calendarError} action={<Button onClick={refreshCalendar}>Reintentar</Button>} /> : <div className="ops-list">{upcoming.map((item) => <article key={item.id}><time>{timestampToLocalParts(item.start).time}</time><strong>{item.title}</strong><span>{workspaces.find((workspace) => workspace.id === item.workspaceId)?.name}</span></article>)}{!upcoming.length && <p>Sin compromisos próximos.</p>}</div>}</section>
      <section className="ops-panel ops-execution"><PanelHead eyebrow="Ejecución" title="Carga por workspace" to="/backlog" label="Abrir Backlog" /><div className="ops-table"><header><span>Workspace</span><span>Pendientes</span><span>En curso</span><span>Vencidas</span></header>{workspaceRows.map(({ workspace, pending, doing, overdue: late }) => <div key={workspace.id}><strong><i style={{ background: workspace.color }} />{workspace.name}</strong><span>{pending}</span><span>{doing}</span><span>{late}</span></div>)}</div><small>{activeProjects.length} proyectos activos · {riskyProjects.length} en riesgo</small></section>
      <section className="ops-panel ops-finance"><PanelHead eyebrow="Finanzas" title="Posición actual" to="/finance" label="Abrir Finanzas" /><div className="ops-kpis ops-kpis--finance"><div><span>Disponible</span><strong>{formatMxn(financeMetrics.availableBalanceCents)}</strong></div><div><span>Gastado hoy</span><strong>{formatMxn(spentToday)}</strong></div><div><span>Gastos del mes</span><strong>{formatMxn(financeMetrics.monthlyExpensesCents)}</strong></div><div><span>Ahorro del mes</span><strong>{formatMxn(financeMetrics.monthlySavingsCents)}</strong></div></div></section>
      <section className="ops-panel ops-direction"><PanelHead eyebrow="Dirección" title="Objetivos y proyectos" to="/goals" label="Abrir objetivos" /><div className="ops-direction__summary"><div><span>Objetivos activos</span><strong>{activeGoals.length}</strong></div><div><span>Proyectos activos</span><strong>{activeProjects.length}</strong></div><div><span>Progreso general</span><strong>{goalProgress}%</strong></div></div><ProgressBar value={goalProgress} />{nextGoal && <p>Próximo vencimiento: <strong>{nextGoal.title}</strong></p>}<div className="ops-goals">{activeGoals.slice(0, 3).map((goal) => <Link key={goal.id} to={`/goals/${goal.id}`}><span>{goal.title}</span><strong>{calculateGoalProgress(tasks, projects, goal.id)}%</strong></Link>)}</div>{activeProjects.slice(0, 1).map((project) => <small key={project.id}>{project.title}: {calculateProjectProgress(tasks, project.id)}%</small>)}</section>
    </div>
  </div>
}

function PanelHead({ eyebrow, title, to, label }: { eyebrow: string; title: string; to?: string; label?: string }) {
  return <header className="ops-panel__head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{to && <Link to={to}>{label}<ArrowUpRight size={14} /></Link>}</header>
}
