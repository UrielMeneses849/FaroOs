import { CalendarDays, LayoutGrid, List, Pause, Pencil, Play, Plus, RotateCcw, Search, Target, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, EmptyState, ProgressBar, StatusBadge } from '../components/common'
import { PageHeader } from '../components/layout'
import { GoalFormDialog } from '../features/planning/PlanningDialogs'
import { useGoals } from '../hooks/useGoals'
import { usePageCapture } from '../hooks/usePageCapture'
import { useWorkspaces } from '../hooks/useWorkspaces'
import { getDeadlineState } from '../lib/planningDates'
import { calculateGoalProgress } from '../lib/taskMetrics'
import { useFaroStore } from '../store'
import type { Goal, GoalStatus } from '../types'

export function GoalsPage() {
  const { capture } = usePageCapture()
  const { data: goals, loading, error, refresh, pauseGoal, reopenGoal, completeGoal, deleteGoal } = useGoals()
  const { data: workspaces } = useWorkspaces()
  const projects = useFaroStore((state) => state.projects)
  const [form, setForm] = useState<Goal | 'new' | null>(null)
  const [query, setQuery] = useState('')
  const [workspace, setWorkspace] = useState('all')
  const [status, setStatus] = useState<GoalStatus | 'all'>('all')
  const [deadline, setDeadline] = useState<'all' | 'due-soon' | 'overdue'>('all')
  const [view, setView] = useState<'cards' | 'list'>('cards')
  const filtered = useMemo(() => goals.filter((goal) => {
    const deadlineState = getDeadlineState(goal.targetDate, goal.status === 'completed')
    return goal.title.toLowerCase().includes(query.toLowerCase())
      && (workspace === 'all' || goal.workspaceId === workspace)
      && (status === 'all' || goal.status === status)
      && (deadline === 'all' || deadlineState === deadline)
  }), [deadline, goals, query, status, workspace])
  const counts = {
    active: goals.filter((goal) => goal.status === 'active').length,
    paused: goals.filter((goal) => goal.status === 'paused').length,
    completed: goals.filter((goal) => goal.status === 'completed').length,
    due: goals.filter((goal) => getDeadlineState(goal.targetDate, goal.status === 'completed') === 'due-soon').length,
  }
  if (loading && !goals.length) return <div className="page"><div className="planning-skeleton" role="status">Cargando objetivos…</div></div>
  if (error && !goals.length) return <div className="page"><EmptyState title="No pudimos cargar tus objetivos" description={error} action={<Button onClick={refresh}>Reintentar</Button>} /></div>
  return <div className="page planning-index">
    <PageHeader eyebrow="Dirección" title="Objetivos" description="Define resultados claros y conecta el trabajo que los hace posibles." onCapture={capture} />
    <div className="planning-summary"><span><b>{counts.active}</b> Activos</span><span><b>{counts.paused}</b> Pausados</span><span><b>{counts.completed}</b> Completados</span><span><b>{counts.due}</b> Próximos a vencer</span><Button icon={<Plus size={15} />} onClick={() => setForm('new')}>Nuevo objetivo</Button></div>
    <div className="planning-filters"><label><Search size={14} /><input aria-label="Buscar objetivos" placeholder="Buscar…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="Workspace" value={workspace} onChange={(event) => setWorkspace(event.target.value)}><option value="all">Todos los workspaces</option>{workspaces.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="Estado" value={status} onChange={(event) => setStatus(event.target.value as GoalStatus | 'all')}><option value="all">Todos los estados</option><option value="active">Activos</option><option value="paused">Pausados</option><option value="completed">Completados</option></select><select aria-label="Vencimiento" value={deadline} onChange={(event) => setDeadline(event.target.value as typeof deadline)}><option value="all">Cualquier fecha</option><option value="due-soon">Próximos</option><option value="overdue">Vencidos</option></select><button aria-label="Vista tarjetas" className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')}><LayoutGrid size={15} /></button><button aria-label="Vista lista" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><List size={15} /></button></div>
    {filtered.length ? <section className={`planning-entities planning-entities--${view}`}>{filtered.map((goal) => {
      const related = projects.filter((project) => project.goalId === goal.id && !project.archivedAt)
      const complete = related.filter((project) => project.status === 'completed').length
      const progress = calculateGoalProgress(projects, goal.id)
      const workspaceName = workspaces.find((item) => item.id === goal.workspaceId)?.name ?? 'Sin workspace'
      const deadlineState = getDeadlineState(goal.targetDate, goal.status === 'completed')
      return <article className="planning-entity" key={goal.id}><div className="planning-entity__head"><span><Target size={15} />{workspaceName}</span><StatusBadge status={goal.status} /></div><Link to={`/goals/${goal.id}`}><h2>{goal.title}</h2></Link><div className="planning-entity__meta">{goal.targetDate && <span className={`deadline deadline--${deadlineState}`}><CalendarDays size={12} />{goal.targetDate}</span>}<span>{complete}/{related.length} proyectos</span></div><ProgressBar value={progress} /><div className="planning-entity__foot"><strong>{progress}%</strong><div><button aria-label={`Editar ${goal.title}`} onClick={() => setForm(goal)}><Pencil size={14} /></button>{goal.status === 'paused' ? <button aria-label={`Reanudar ${goal.title}`} onClick={() => reopenGoal(goal.id)}><Play size={14} /></button> : goal.status === 'completed' ? <button aria-label={`Reabrir ${goal.title}`} onClick={() => reopenGoal(goal.id)}><RotateCcw size={14} /></button> : <button aria-label={`Pausar ${goal.title}`} onClick={() => pauseGoal(goal.id)}><Pause size={14} /></button>}<button aria-label={`Completar ${goal.title}`} onClick={() => completeGoal(goal.id)}>✓</button><button aria-label={`Eliminar ${goal.title}`} onClick={() => deleteGoal(goal.id)}><Trash2 size={14} /></button></div></div></article>
    })}</section> : <EmptyState title="No encontramos objetivos" description="Ajusta los filtros o crea un nuevo objetivo." action={<Button onClick={() => setForm('new')}>Nuevo objetivo</Button>} />}
    {form && <GoalFormDialog open initial={form === 'new' ? undefined : form} onClose={() => setForm(null)} />}
  </div>
}
