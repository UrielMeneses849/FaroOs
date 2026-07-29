import { CalendarDays, FolderKanban, LayoutGrid, List, Pause, Pencil, Play, Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, EmptyState, ProgressBar, StatusBadge } from '../components/common'
import { PageHeader } from '../components/layout'
import { ProjectFormDialog } from '../features/planning/PlanningDialogs'
import { usePageCapture } from '../hooks/usePageCapture'
import { useProjects } from '../hooks/useProjects'
import { useWorkspaces } from '../hooks/useWorkspaces'
import { getDeadlineState } from '../lib/planningDates'
import { calculateProjectProgress } from '../lib/taskMetrics'
import { useFaroStore } from '../store'
import type { Project, ProjectStatus } from '../types'

export function ProjectsPage() {
  const { capture } = usePageCapture()
  const { data: projects, loading, error, refresh, pauseProject, reopenProject, completeProject, deleteProject } = useProjects()
  const { data: workspaces } = useWorkspaces()
  const goals = useFaroStore((state) => state.goals)
  const tasks = useFaroStore((state) => state.tasks)
  const [form, setForm] = useState<Project | 'new' | null>(null)
  const [query, setQuery] = useState('')
  const [workspace, setWorkspace] = useState('all')
  const [goal, setGoal] = useState('all')
  const [status, setStatus] = useState<ProjectStatus | 'all'>('all')
  const [deadline, setDeadline] = useState<'all' | 'due-soon' | 'overdue'>('all')
  const [view, setView] = useState<'cards' | 'list'>('cards')
  const filtered = useMemo(() => projects.filter((project) => project.title.toLowerCase().includes(query.toLowerCase()) && (workspace === 'all' || project.workspaceId === workspace) && (goal === 'all' || project.goalId === goal) && (status === 'all' || project.status === status) && (deadline === 'all' || getDeadlineState(project.endDate, project.status === 'completed') === deadline)), [deadline, goal, projects, query, status, workspace])
  const count = (value: ProjectStatus) => projects.filter((project) => project.status === value).length
  if (loading && !projects.length) return <div className="page"><div className="planning-skeleton" role="status">Cargando proyectos…</div></div>
  if (error && !projects.length) return <div className="page"><EmptyState title="No pudimos cargar tus proyectos" description={error} action={<Button onClick={refresh}>Reintentar</Button>} /></div>
  return <div className="page planning-index"><PageHeader eyebrow="Ejecución" title="Proyectos" description="Convierte objetivos en sistemas de trabajo concretos." onCapture={capture} />
    <div className="planning-summary"><span><b>{count('active')}</b> Activos</span><span><b>{count('planned')}</b> Planeados</span><span><b>{count('paused')}</b> Pausados</span><span><b>{count('completed')}</b> Completados</span><span><b>{projects.filter((item) => getDeadlineState(item.endDate, item.status === 'completed') === 'overdue').length}</b> Vencidos</span><Button icon={<Plus size={15} />} onClick={() => setForm('new')}>Nuevo proyecto</Button></div>
    <div className="planning-filters"><label><Search size={14} /><input aria-label="Buscar proyectos" placeholder="Buscar…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="Workspace" value={workspace} onChange={(event) => setWorkspace(event.target.value)}><option value="all">Todos los workspaces</option>{workspaces.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="Objetivo" value={goal} onChange={(event) => setGoal(event.target.value)}><option value="all">Todos los objetivos</option>{goals.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><select aria-label="Estado" value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus | 'all')}><option value="all">Todos los estados</option><option value="planned">Planeados</option><option value="active">Activos</option><option value="paused">Pausados</option><option value="completed">Completados</option></select><select aria-label="Vencimiento" value={deadline} onChange={(event) => setDeadline(event.target.value as typeof deadline)}><option value="all">Cualquier fecha</option><option value="due-soon">Próximos</option><option value="overdue">Vencidos</option></select><button aria-label="Vista tarjetas" className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')}><LayoutGrid size={15} /></button><button aria-label="Vista lista" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><List size={15} /></button></div>
    {filtered.length ? <section className={`planning-entities planning-entities--${view}`}>{filtered.map((project) => { const related = tasks.filter((task) => task.projectId === project.id && !task.archivedAt); const complete = related.filter((task) => task.status === 'done').length; const progress = calculateProjectProgress(tasks, project.id); const workspaceName = workspaces.find((item) => item.id === project.workspaceId)?.name ?? 'Sin workspace'; const goalName = goals.find((item) => item.id === project.goalId)?.title; return <article className="planning-entity" key={project.id}><div className="planning-entity__head"><span><FolderKanban size={15} />{workspaceName}</span><StatusBadge status={project.status} /></div><Link to={`/projects/${project.id}`}><h2>{project.title}</h2></Link><div className="planning-entity__meta">{goalName && <span>{goalName}</span>}{project.endDate && <span className={`deadline deadline--${getDeadlineState(project.endDate, project.status === 'completed')}`}><CalendarDays size={12} />{project.endDate}</span>}<span>{complete}/{related.length} tareas</span></div><ProgressBar value={progress} /><div className="planning-entity__foot"><strong>{progress}%</strong><div><button aria-label={`Editar ${project.title}`} onClick={() => setForm(project)}><Pencil size={14} /></button>{project.status === 'paused' ? <button aria-label={`Reanudar ${project.title}`} onClick={() => reopenProject(project.id)}><Play size={14} /></button> : <button aria-label={`Pausar ${project.title}`} onClick={() => pauseProject(project.id)}><Pause size={14} /></button>}<button aria-label={`Completar ${project.title}`} onClick={() => completeProject(project.id)}>✓</button><button aria-label={`Eliminar ${project.title}`} onClick={() => deleteProject(project.id)}><Trash2 size={14} /></button></div></div></article> })}</section> : <EmptyState title="No encontramos proyectos" description="Ajusta los filtros o crea el primer proyecto." action={<Button onClick={() => setForm('new')}>Nuevo proyecto</Button>} />}
    {form && <ProjectFormDialog open initial={form === 'new' ? undefined : form} onClose={() => setForm(null)} />}
  </div>
}
