import { CalendarDays, CheckCircle2, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AreaBadge, Button, ConfirmDialog, ProgressBar, StatusBadge } from '../components/common'
import { ProjectFormDialog, TaskFormDialog } from '../features/planning/PlanningDialogs'
import { TaskLine } from '../features/planning/TaskLine'
import { calculateProjectProgress, calculateTotalMinutes } from '../lib/taskMetrics'
import { useFaroStore } from '../store'
import { useWorkspaces } from '../hooks/useWorkspaces'
import type { Task } from '../types'

export function ProjectDetailPage() {
  const { projectId } = useParams()
  const { data: workspaces } = useWorkspaces()
  const project = useFaroStore((state) => state.projects.find((item) => item.id === projectId))
  const tasks = useFaroStore((state) => state.tasks)
  const goals = useFaroStore((state) => state.goals)
  const updateProject = useFaroStore((state) => state.updateProject)
  const deleteProject = useFaroStore((state) => state.deleteProject)
  const deleteTask = useFaroStore((state) => state.deleteTask)
  const [editing, setEditing] = useState(false)
  const [taskForm, setTaskForm] = useState<Task | 'new' | null>(null)
  const [deletingTask, setDeletingTask] = useState<Task | null>(null)
  const [deletingProject, setDeletingProject] = useState(false)
  if (!project) return <Navigate to="/projects" replace />
  const projectTasks = tasks.filter((task) => task.projectId === project.id && !task.archivedAt)
  const goal = goals.find((item) => item.id === project.goalId)
  const progress = calculateProjectProgress(tasks, project.id)
  return <div className="page detail-page">
    <Link className="back-link" to="/projects">← Proyectos</Link>
    <header className="detail-hero"><div><span className="eyebrow">Proyecto</span><h1>{project.title}</h1><div className="detail-tags"><AreaBadge area={project.area} /><span>{workspaces.find((item) => item.id === project.workspaceId)?.name ?? 'Sin workspace'}</span><StatusBadge status={project.status} /><span className={`priority priority--${project.priority}`}>{project.priority}</span></div></div><div className="detail-actions"><Button variant="secondary" icon={<Pencil size={14} />} onClick={() => setEditing(true)}>Editar</Button><Button icon={<CheckCircle2 size={14} />} onClick={() => updateProject(project.id, { status: project.status === 'completed' ? 'active' : 'completed' })}>{project.status === 'completed' ? 'Reabrir' : 'Finalizar'}</Button><Button variant="ghost" icon={<Trash2 size={14} />} disabled={projectTasks.length > 0} onClick={() => setDeletingProject(true)}>Eliminar</Button></div></header>
    <section className="detail-summary"><div><span>Progreso automático</span><strong>{progress}%</strong><ProgressBar value={progress} /></div><div><span>Tareas</span><strong>{projectTasks.length}</strong></div><div><span>Tiempo estimado</span><strong>{calculateTotalMinutes(projectTasks)} min</strong></div></section>
    <div className="project-context">{goal && <Link to={`/goals/${goal.id}`}><Target size={14} />Objetivo: {goal.title}</Link>}{(project.startDate || project.endDate) && <span><CalendarDays size={14} />{project.startDate || '—'} → {project.endDate || '—'}</span>}</div>
    {project.description && <section className="detail-description"><span className="eyebrow">Descripción</span><p>{project.description}</p></section>}
    <section className="detail-section detail-section--wide"><div className="detail-section__head"><div><CheckCircle2 size={17} /><h2>Tareas</h2></div><Button size="sm" icon={<Plus size={13} />} onClick={() => setTaskForm('new')}>Nueva tarea</Button></div>{projectTasks.length ? projectTasks.map((task) => <TaskLine key={task.id} task={task} onEdit={() => setTaskForm(task)} onDelete={() => setDeletingTask(task)} />) : <p className="section-empty">Crea la primera tarea para activar el progreso.</p>}</section>
    <section className="history-strip"><span>Creado {new Date(project.createdAt).toLocaleDateString('es-MX')}</span><span>Última actualización {new Date(project.updatedAt).toLocaleDateString('es-MX')}</span><span>Estado: {project.status}</span></section>
    {editing && <ProjectFormDialog open initial={project} onClose={() => setEditing(false)} />}
    {taskForm && <TaskFormDialog open initial={taskForm === 'new' ? undefined : taskForm} projectId={project.id} goalId={project.goalId} workspaceId={project.workspaceId} onClose={() => setTaskForm(null)} />}
    <ConfirmDialog open={Boolean(deletingTask)} title="Eliminar tarea" description="La tarea se eliminará permanentemente." onClose={() => setDeletingTask(null)} onConfirm={() => { if (deletingTask) deleteTask(deletingTask.id); setDeletingTask(null) }} />
    <ConfirmDialog open={deletingProject} title="Eliminar proyecto" description="Solo se puede eliminar cuando ya no tiene tareas relacionadas." onClose={() => setDeletingProject(false)} onConfirm={() => { deleteProject(project.id); setDeletingProject(false) }} />
  </div>
}
