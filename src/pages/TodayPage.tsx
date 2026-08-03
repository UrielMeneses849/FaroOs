import { differenceInMinutes, format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertTriangle, CalendarClock, Check, Circle, Ellipsis, FolderKanban, Plus, Scale, Timer, Workflow } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, EmptyState } from '../components/common'
import { StatusSelector } from '../components/common/StatusSelector'
import { PageHeader } from '../components/layout'
import { TaskFormDialog } from '../features/planning/PlanningDialogs'
import { useCalendarData } from '../hooks/useCalendarData'
import { useFinance } from '../hooks/useFinance'
import { usePageCapture } from '../hooks/usePageCapture'
import { useTodayTasks } from '../hooks/useTodayTasks'
import { useWorkspaces } from '../hooks/useWorkspaces'
import { localDate, timestampToLocalParts } from '../lib/calendarDates'
import { formatMxn } from '../services/financeService'
import { useFaroStore } from '../store'
import type { Task, TaskStatus } from '../types'

export function TodayPage() {
  const { capture } = usePageCapture(); const navigate = useNavigate()
  const { data: workspaces, loading: workspacesLoading, error: workspaceError, refresh: refreshWorkspaces, restoreDefaults } = useWorkspaces()
  const { data: tasks, loading: tasksLoading, error: tasksError, refresh: refreshTasks } = useTodayTasks(true)
  const { data: calendarData, loading: calendarLoading, error: calendarError, refresh: refreshCalendar } = useCalendarData()
  const { data: finance } = useFinance()
  const projects = useFaroStore((state) => state.projects); const healthLogs = useFaroStore((state) => state.healthLogs)
  const updateTask = useFaroStore((state) => state.updateTask); const deleteTask = useFaroStore((state) => state.deleteTask)
  const [editing, setEditing] = useState<Task | 'new' | null>(null); const [createWorkspaceId, setCreateWorkspaceId] = useState<string>()
  const today = localDate(); const now = new Date()
  const activeWorkspaces = workspaces.filter((workspace) => workspace.isActive)
  const todayHealth = healthLogs.find((item) => item.occurredAt.slice(0, 10) === today)
  const latestWeight = [...healthLogs].filter((item) => item.weightKg != null).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]?.weightKg
  const todayExpenses = finance.transactions.filter((item) => item.transactionDate === today && item.status === 'completed' && (item.type === 'expense' || item.type === 'debt_payment'))
  const todayTasks = tasks.filter((task) => task.dueDate === today || (task.status !== 'done' && Boolean(task.dueDate && task.dueDate < today)))
  const completed = todayTasks.filter((task) => task.status === 'done').length; const pending = todayTasks.length - completed
  const scheduled = useMemo(() => calendarData.items.filter((item) => {
    if (item.allDay || (item.sourceType !== 'task' && item.sourceType !== 'event')) return false
    return timestampToLocalParts(item.start).date === today
  }).sort((a, b) => a.start.localeCompare(b.start)), [calendarData.items, today])
  const unscheduled = todayTasks.filter((task) => task.status !== 'done' && !task.dueAt)
  const openCreate = (workspaceId?: string) => { setCreateWorkspaceId(workspaceId); setEditing('new') }

  if (workspacesLoading || tasksLoading || calendarLoading) return <div className="page today-context"><div className="today-skeleton" role="status">Preparando tu día…</div></div>
  if (workspaceError || tasksError || calendarError) return <div className="page"><EmptyState title="No pudimos cargar Hoy" description={workspaceError ?? tasksError ?? calendarError ?? ''} action={<Button onClick={() => { void refreshWorkspaces(); void refreshTasks(); void refreshCalendar() }}>Reintentar</Button>} /></div>
  if (!activeWorkspaces.length) return <div className="page"><EmptyState title="No hay workspaces activos" description="Restaura tus contextos iniciales." action={<Button onClick={() => void restoreDefaults()}>Restaurar contextos</Button>} /></div>

  return <div className="page today-context">
    <PageHeader eyebrow={format(new Date(), "EEEE, d 'de' MMMM", { locale: es })} title="Hoy" description="Agenda y pendientes, separados con claridad." onCapture={capture} />
    <section className="today-context__summary"><div><span>Pendientes</span><strong>{pending}</strong></div><div><span>Completadas</span><strong>{completed}</strong></div><button className="today-context__weight" data-missing={!todayHealth?.weightKg} onClick={() => navigate('/health')}><Scale size={16} /><span>{todayHealth?.weightKg ? 'Peso de hoy' : 'Peso pendiente'}</span><strong>{todayHealth?.weightKg ? `${todayHealth.weightKg} kg` : latestWeight ? `Último: ${latestWeight} kg` : 'Registrar peso'}</strong><small>{todayHealth?.weightKg ? 'Capturado hoy' : 'Aún no lo has capturado hoy'}</small></button><button className="today-context__spending" onClick={() => { sessionStorage.setItem('faro-finance-panel', 'transactions'); navigate('/finance') }}><span>Gastado hoy</span><strong>{formatMxn(todayExpenses.reduce((sum, item) => sum + item.amountCents, 0))}</strong></button></section>
    <div className="today-operational-grid">
      <section className="today-agenda-board">
        <header><div><CalendarClock size={16} /><div><span className="eyebrow">Agenda</span><h2>Agenda de hoy</h2></div></div><button onClick={() => navigate('/calendar')}>Ver calendario</button></header>
        <div className="today-agenda-list">{scheduled.map((item) => {
          const start = parseISO(item.start); const end = item.end ? parseISO(item.end) : undefined
          const state = end && end < now ? 'past' : start <= now && (!end || end >= now) ? 'current' : 'next'
          return <button key={item.id} data-state={state} onClick={() => item.sourceType === 'task' ? setEditing(tasks.find((task) => task.id === item.sourceId) ?? null) : navigate('/calendar')}><time>{timestampToLocalParts(item.start).time}</time><i style={{ background: activeWorkspaces.find((workspace) => workspace.id === item.workspaceId)?.color }} /><div><strong>{item.title}</strong><span>{activeWorkspaces.find((workspace) => workspace.id === item.workspaceId)?.name ?? 'Sin workspace'}{end ? ` · ${differenceInMinutes(end, start)} min` : ''} · {item.sourceType === 'task' ? 'Tarea' : item.entryKind === 'focus' ? 'Enfoque' : 'Evento'}</span></div></button>
        })}{!scheduled.length && <p>Sin bloques con horario para hoy.</p>}</div>
        <div className="today-unscheduled"><header><div><span className="eyebrow">Sin programar</span><h3>Tareas sin hora</h3></div><span>{unscheduled.length}</span></header>{unscheduled.slice(0, 5).map((task) => <article key={task.id}><div><strong>{task.title}</strong><span>{activeWorkspaces.find((workspace) => workspace.id === task.workspaceId)?.name}</span></div><button onClick={() => setEditing(task)}>Asignar hora</button></article>)}{!unscheduled.length && <p>Todas las tareas de hoy tienen horario.</p>}</div>
      </section>
      <section className="today-workspaces-board"><header><div><span className="eyebrow">Ejecución</span><h2>Pendientes por workspace</h2></div><Button size="sm" icon={<Plus size={14} />} onClick={() => openCreate()}>Nueva tarea</Button></header><div>{activeWorkspaces.map((workspace) => { const workspaceTasks = tasks.filter((task) => task.workspaceId === workspace.id && task.status !== 'done' && !task.archivedAt); return <section className="today-workspace-card" key={workspace.id}><header><div><i style={{ background: workspace.color }} /><strong>{workspace.name}</strong></div><b>{workspaceTasks.length}</b></header>{workspaceTasks.slice(0, 3).map((task) => <ContextTaskRow key={task.id} task={task} project={projects.find((project) => project.id === task.projectId)?.title} workspaces={activeWorkspaces} onUpdate={(changes) => updateTask(task.id, changes)} onEdit={() => setEditing(task)} onDelete={() => deleteTask(task.id)} />)}{!workspaceTasks.length && <p>Sin pendientes.</p>}<footer><button onClick={() => navigate(`/backlog?workspace=${workspace.id}`)}>Ver todas</button><button onClick={() => openCreate(workspace.id)}>Añadir</button></footer></section>})}</div></section>
    </div>
    {editing && <TaskFormDialog open initial={editing === 'new' ? undefined : editing} workspaceId={createWorkspaceId} onClose={() => { setEditing(null); setCreateWorkspaceId(undefined) }} />}
  </div>
}

function ContextTaskRow({ task, project, workspaces, onUpdate, onEdit, onDelete }: { task: Task; project?: string; workspaces: Array<{ id: string; name: string }>; onUpdate: (changes: Partial<Task>) => void; onEdit: () => void; onDelete: () => void }) {
  const [menu, setMenu] = useState(false); const today = localDate(); const overdue = task.status !== 'done' && Boolean(task.dueDate && task.dueDate < today)
  return <article className={`context-task ${overdue ? 'context-task--overdue' : ''}`}><button className="context-task__check" aria-label={task.status === 'done' ? `Reabrir ${task.title}` : `Completar ${task.title}`} onClick={() => onUpdate({ status: task.status === 'done' ? 'todo' : 'done' })}>{task.status === 'done' ? <Check size={14} /> : <Circle size={15} />}</button><div className="context-task__body"><strong>{task.title}</strong><div><StatusSelector task={task} value={task.status} onChange={(status: TaskStatus) => onUpdate({ status })} />{task.dueDate && <span className={overdue ? 'overdue' : ''}>{overdue && <AlertTriangle size={11} />}{task.dueDate}</span>}{project && <span><FolderKanban size={11} />{project}</span>}{task.status === 'blocked' && <span><Workflow size={11} />Bloqueada</span>}{task.status === 'paused' && <span><Timer size={11} />Pausada</span>}</div></div><div className="context-task__menu"><button aria-label={`Acciones de ${task.title}`} onClick={() => setMenu((value) => !value)}><Ellipsis size={17} /></button>{menu && <div><button onClick={onEdit}>Editar</button><label>Mover<select value={task.workspaceId ?? ''} onChange={(event) => onUpdate({ workspaceId: event.target.value })}>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label><button className="danger" onClick={onDelete}>Eliminar</button></div>}</div></article>
}
