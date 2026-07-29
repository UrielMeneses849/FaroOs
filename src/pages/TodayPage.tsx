import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertTriangle, Check, Circle, Ellipsis, FolderKanban, List, Plus, Rows3, Timer, Workflow } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, EmptyState } from '../components/common'
import { StatusSelector } from '../components/common/StatusSelector'
import { PageHeader } from '../components/layout'
import { TaskFormDialog } from '../features/planning/PlanningDialogs'
import { useFinance } from '../hooks/useFinance'
import { useTodayTasks } from '../hooks/useTodayTasks'
import { usePageCapture } from '../hooks/usePageCapture'
import { useWorkspaces } from '../hooks/useWorkspaces'
import { useFaroStore } from '../store'
import { localDate, parseTimestamp, timestampToLocalParts } from '../lib/calendarDates'
import { formatMxn } from '../services/financeService'
import type { Priority, Task, TaskStatus } from '../types'

export function TodayPage() {
  const { capture } = usePageCapture()
  const navigate = useNavigate()
  const { data: workspaces, loading: workspacesLoading, error: workspaceError, refresh: refreshWorkspaces, restoreDefaults } = useWorkspaces()
  const { data: queriedTasks, loading: tasksLoading, error: tasksError, refresh: refreshTasks } = useTodayTasks(true)
  const { data: finance } = useFinance()
  const projects = useFaroStore((state) => state.projects)
  const updateTask = useFaroStore((state) => state.updateTask)
  const deleteTask = useFaroStore((state) => state.deleteTask)
  const [editing, setEditing] = useState<Task | 'new' | null>(null)
  const [createWorkspaceId, setCreateWorkspaceId] = useState<string>()
  const [workspaceFilter, setWorkspaceFilter] = useState('all')
  const [priority, setPriority] = useState<Priority | 'all'>('all')
  const [status, setStatus] = useState<TaskStatus | 'all'>('all')
  const [view, setView] = useState<'grouped' | 'list'>('grouped')
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'overdue' | 'untimed'>('all')
  const [showEmpty, setShowEmpty] = useState(false)
  const [renderedAt] = useState(() => Date.now())
  const today = localDate()
  const todayExpenses = finance.transactions.filter((item) =>
    item.transactionDate === today && item.status === 'completed'
    && (item.type === 'expense' || item.type === 'debt_payment'))
  const spentToday = todayExpenses.reduce((sum, item) => sum + item.amountCents, 0)

  const tasks = useMemo(() => queriedTasks
    .filter((task) => task.dueDate === today || (task.status !== 'done' && Boolean(task.dueDate && task.dueDate < today)))
    .filter((task) => workspaceFilter === 'all' || task.workspaceId === workspaceFilter)
    .filter((task) => priority === 'all' || task.priority === priority)
    .filter((task) => status === 'all' || task.status === status), [priority, queriedTasks, status, today, workspaceFilter])
  const visibleTasks = tasks.filter((task) =>
    dateFilter === 'all'
    || (dateFilter === 'today' && task.dueDate === today)
    || (dateFilter === 'overdue' && task.status !== 'done' && Boolean(task.dueDate && task.dueDate < today))
    || (dateFilter === 'untimed' && !task.dueAt))
  const completed = tasks.filter((task) => task.status === 'done').length
  const pending = tasks.length - completed
  const overdueCount = tasks.filter((task) => task.status !== 'done' && Boolean(task.dueDate && task.dueDate < today)).length
  const upcoming = queriedTasks.filter((task) => task.status !== 'done' && task.dueAt && (parseTimestamp(task.dueAt)?.getTime() ?? 0) >= renderedAt)
    .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))[0]
  const priorityTask = tasks.find((task) => task.status !== 'done' && task.dueDate === today && (task.priority === 'critical' || task.priority === 'high'))
    ?? upcoming ?? tasks.find((task) => task.status !== 'done')
  const activeWorkspaces = workspaces.filter((workspace) => workspace.isActive)
  const openCreate = (workspaceId?: string) => { setCreateWorkspaceId(workspaceId); setEditing('new') }

  if (workspacesLoading || tasksLoading) return <div className="page today-context"><div className="today-skeleton" role="status">Preparando tus contextos…</div></div>
  if (workspaceError || tasksError) return <div className="page"><EmptyState title="No pudimos cargar Hoy" description={workspaceError ?? tasksError ?? ''} action={<Button onClick={() => { void refreshWorkspaces(); void refreshTasks() }}>Reintentar</Button>} /></div>
  if (!activeWorkspaces.length) return <div className="page"><EmptyState title="No hay workspaces activos" description="Restaura tus contextos iniciales para organizar las tareas." action={<Button onClick={() => void restoreDefaults()}>Restaurar contextos</Button>} /></div>

  return <div className="page today-context">
    <PageHeader eyebrow={format(new Date(), "EEEE, d 'de' MMMM", { locale: es })} title="Hoy" description="Tu atención, separada por el contexto correcto." onCapture={capture} />
    <section className="today-context__summary"><div><span>Pendientes</span><strong>{pending}</strong></div><div><span>Completadas</span><strong>{completed}</strong></div><button className="today-context__spending" onClick={() => { sessionStorage.setItem('faro-finance-panel', 'transactions'); navigate('/finance') }}><span>Gastado hoy</span><strong>{formatMxn(spentToday)}</strong></button></section>
    <section className="today-brief"><div><span>Siguiente</span><strong>{upcoming ? `${timestampToLocalParts(upcoming.dueAt).time} · ${upcoming.title}` : 'Sin tareas programadas para las próximas horas'}</strong></div><div><span>Vencidas</span><strong>{overdueCount} {overdueCount === 1 ? 'tarea' : 'tareas'}</strong></div>{priorityTask && <div><span>Prioridad del día</span><strong>{priorityTask.title}</strong></div>}</section>
    <div className="today-context__toolbar">
      <div className="context-chips" aria-label="Filtrar por workspace"><button className={workspaceFilter === 'all' ? 'active' : ''} onClick={() => setWorkspaceFilter('all')}>Todos</button>{activeWorkspaces.map((workspace) => <button key={workspace.id} className={workspaceFilter === workspace.id ? 'active' : ''} onClick={() => setWorkspaceFilter(workspace.id)}>{workspace.name}</button>)}</div>
      <div className="today-context__selects"><select aria-label="Fecha" value={dateFilter} onChange={(event) => setDateFilter(event.target.value as typeof dateFilter)}><option value="all">Todas</option><option value="today">Hoy</option><option value="overdue">Vencidas</option><option value="untimed">Sin hora</option></select><select aria-label="Prioridad" value={priority} onChange={(event) => setPriority(event.target.value as Priority | 'all')}><option value="all">Prioridad</option><option value="critical">Crítica</option><option value="high">Alta</option><option value="medium">Media</option><option value="low">Baja</option></select><select aria-label="Estado" value={status} onChange={(event) => setStatus(event.target.value as TaskStatus | 'all')}><option value="all">Estado</option><option value="todo">Por hacer</option><option value="doing">En curso</option><option value="paused">Pausada</option><option value="blocked">Bloqueada</option><option value="done">Completada</option></select><button aria-label="Vista agrupada" className={view === 'grouped' ? 'active' : ''} onClick={() => setView('grouped')}><Rows3 size={15} /></button><button aria-label="Lista única" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><List size={15} /></button></div>
    </div>
    {view === 'grouped' ? <div className="workspace-groups">{activeWorkspaces.map((workspace) => {
      const workspaceTasks = visibleTasks.filter((task) => task.workspaceId === workspace.id)
      if (!showEmpty && !workspaceTasks.length) return null
      return <section className="workspace-group" key={workspace.id}><header><div><i style={{ background: workspace.color }} /><h2>{workspace.name === 'Personal' ? 'Prioridades personales' : workspace.name}</h2><span>{workspaceTasks.length}</span></div><button onClick={() => openCreate(workspace.id)}><Plus size={14} /> Añadir</button></header>{workspaceTasks.length ? workspaceTasks.map((task) => <ContextTaskRow key={task.id} task={task} project={projects.find((project) => project.id === task.projectId)?.title} workspaces={activeWorkspaces} onUpdate={(changes) => updateTask(task.id, changes)} onEdit={() => setEditing(task)} onDelete={() => deleteTask(task.id)} />) : <p className="workspace-group__empty">Sin tareas para hoy.</p>}</section>
    })}<button className="show-empty" onClick={() => setShowEmpty((value) => !value)}>{showEmpty ? 'Ocultar contextos vacíos' : 'Mostrar contextos vacíos'}</button></div> : <section className="workspace-group workspace-group--list">{visibleTasks.map((task) => <ContextTaskRow key={task.id} task={task} project={projects.find((project) => project.id === task.projectId)?.title} workspaces={activeWorkspaces} onUpdate={(changes) => updateTask(task.id, changes)} onEdit={() => setEditing(task)} onDelete={() => deleteTask(task.id)} />)}{!visibleTasks.length && <EmptyState title="Nada pendiente para este filtro" description="Ajusta los filtros o crea una tarea." action={<Button icon={<Plus size={15} />} onClick={() => openCreate()}>Crear tarea</Button>} />}</section>}
    <Button className="today-context__create" icon={<Plus size={15} />} onClick={() => openCreate()}>Crear tarea</Button>
    {editing && <TaskFormDialog open initial={editing === 'new' ? undefined : editing} workspaceId={createWorkspaceId} onClose={() => { setEditing(null); setCreateWorkspaceId(undefined) }} />}
  </div>
}

function ContextTaskRow({ task, project, workspaces, onUpdate, onEdit, onDelete }: { task: Task; project?: string; workspaces: Array<{ id: string; name: string }>; onUpdate: (changes: Partial<Task>) => void; onEdit: () => void; onDelete: () => void }) {
  const [menu, setMenu] = useState(false)
  const today = localDate()
  const overdue = task.status !== 'done' && Boolean(task.dueDate && task.dueDate < today)
  return <article className={`context-task ${overdue ? 'context-task--overdue' : ''}`}>
    <button className="context-task__check" aria-label={task.status === 'done' ? `Reabrir ${task.title}` : `Completar ${task.title}`} onClick={() => onUpdate({ status: task.status === 'done' ? 'todo' : 'done' })}>{task.status === 'done' ? <Check size={14} /> : <Circle size={15} />}</button>
    <div className="context-task__body"><strong>{task.title}</strong><div><StatusSelector task={task} value={task.status} onChange={(status) => onUpdate({ status })} /><span className={`priority priority--${task.priority}`}>{task.priority}</span>{task.dueDate && <span className={overdue ? 'overdue' : ''}>{overdue && <AlertTriangle size={11} />}{task.dueDate}</span>}{project && <span><FolderKanban size={11} />{project}</span>}{task.status === 'blocked' && <span><Workflow size={11} />Bloqueada</span>}{task.status === 'paused' && <span><Timer size={11} />Pausada</span>}</div></div>
    <div className="context-task__menu"><button aria-label={`Acciones de ${task.title}`} onClick={() => setMenu((value) => !value)}><Ellipsis size={17} /></button>{menu && <div><button onClick={onEdit}>Editar</button><label>Mover<select value={task.workspaceId ?? ''} onChange={(event) => onUpdate({ workspaceId: event.target.value })}>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label><button onClick={() => onUpdate({ status: 'paused', pausedUntil: task.dueDate })}>Pausar</button><button className="danger" onClick={onDelete}>Eliminar</button></div>}</div>
  </article>
}
