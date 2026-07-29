import { CalendarDays, CheckCircle2, FolderKanban, Pause, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AreaBadge, Button, ConfirmDialog, ProgressBar, StatusBadge } from '../components/common'
import { GoalFormDialog, ProjectFormDialog, TaskFormDialog } from '../features/planning/PlanningDialogs'
import { TaskLine } from '../features/planning/TaskLine'
import { calculateGoalProgress, calculateProjectProgress } from '../lib/taskMetrics'
import { useFaroStore } from '../store'
import { useWorkspaces } from '../hooks/useWorkspaces'
import type { Task } from '../types'

export function GoalDetailPage() {
  const { goalId } = useParams()
  const { data: workspaces } = useWorkspaces()
  const goal = useFaroStore((state) => state.goals.find((item) => item.id === goalId))
  const projects = useFaroStore((state) => state.projects)
  const tasks = useFaroStore((state) => state.tasks)
  const updateGoal = useFaroStore((state) => state.updateGoal)
  const deleteGoal = useFaroStore((state) => state.deleteGoal)
  const deleteTask = useFaroStore((state) => state.deleteTask)
  const [editGoal, setEditGoal] = useState(false)
  const [newProject, setNewProject] = useState(false)
  const [taskForm, setTaskForm] = useState<Task | 'new' | null>(null)
  const [deletingTask, setDeletingTask] = useState<Task | null>(null)
  const [deletingGoal, setDeletingGoal] = useState(false)
  if (!goal) return <Navigate to="/goals" replace />
  const relatedProjects = projects.filter((project) => project.goalId === goal.id && !project.archivedAt)
  const relatedTasks = tasks.filter((task) => task.goalId === goal.id && !task.projectId && !task.archivedAt)
  const progress = calculateGoalProgress(tasks, projects, goal.id)
  return <div className="page detail-page">
    <Link className="back-link" to="/goals">← Objetivos</Link>
    <header className="detail-hero"><div><span className="eyebrow">Objetivo</span><h1>{goal.title}</h1><div className="detail-tags"><AreaBadge area={goal.area} /><span>{workspaces.find((item) => item.id === goal.workspaceId)?.name ?? 'Sin workspace'}</span><StatusBadge status={goal.status} />{goal.targetDate && <span><CalendarDays size={13} />{goal.targetDate}</span>}</div></div><div className="detail-actions"><Button variant="secondary" icon={<Pencil size={14} />} onClick={() => setEditGoal(true)}>Editar</Button><Button variant="secondary" icon={<Pause size={14} />} onClick={() => updateGoal(goal.id, { status: goal.status === 'paused' ? 'active' : 'paused' })}>{goal.status === 'paused' ? 'Reanudar' : 'Pausar'}</Button><Button icon={<CheckCircle2 size={14} />} onClick={() => updateGoal(goal.id, { status: goal.status === 'completed' ? 'active' : 'completed' })}>{goal.status === 'completed' ? 'Reabrir' : 'Finalizar'}</Button><Button variant="ghost" icon={<Trash2 size={14} />} disabled={relatedProjects.length > 0} onClick={() => setDeletingGoal(true)}>Eliminar</Button></div></header>
    <section className="detail-summary"><div><span>Progreso derivado</span><strong>{progress}%</strong><ProgressBar value={progress} /></div><div><span>Proyectos</span><strong>{relatedProjects.length}</strong></div><div><span>Tareas relacionadas</span><strong>{relatedTasks.length}</strong></div></section>
    {goal.description && <section className="detail-description"><span className="eyebrow">Intención</span><p>{goal.description}</p></section>}
    <div className="detail-grid"><section className="detail-section"><div className="detail-section__head"><div><FolderKanban size={17} /><h2>Proyectos</h2></div><Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setNewProject(true)}>Añadir</Button></div>{relatedProjects.length ? relatedProjects.map((project) => <Link className="related-row" to={`/projects/${project.id}`} key={project.id}><div><strong>{project.title}</strong><small>{calculateProjectProgress(tasks, project.id)}% completado</small></div><span>→</span></Link>) : <p className="section-empty">Todavía no hay proyectos vinculados.</p>}</section>
      <section className="detail-section"><div className="detail-section__head"><div><Target size={17} /><h2>Tareas directas</h2></div><Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setTaskForm('new')}>Añadir</Button></div>{relatedTasks.length ? relatedTasks.map((task) => <TaskLine key={task.id} task={task} onEdit={() => setTaskForm(task)} onDelete={() => setDeletingTask(task)} />) : <p className="section-empty">Sin tareas directas por ahora.</p>}</section>
    </div>
    <section className="history-strip"><span>Creado {new Date(goal.createdAt).toLocaleDateString('es-MX')}</span><span>Última actualización {new Date(goal.updatedAt).toLocaleDateString('es-MX')}</span><span>Estado: {goal.status}</span></section>
    {editGoal && <GoalFormDialog open initial={goal} onClose={() => setEditGoal(false)} />}
    {newProject && <ProjectFormDialog open goalId={goal.id} workspaceId={goal.workspaceId} onClose={() => setNewProject(false)} />}
    {taskForm && <TaskFormDialog open initial={taskForm === 'new' ? undefined : taskForm} goalId={goal.id} workspaceId={goal.workspaceId} onClose={() => setTaskForm(null)} />}
    <ConfirmDialog open={Boolean(deletingTask)} title="Eliminar tarea" description="La tarea se eliminará permanentemente." onClose={() => setDeletingTask(null)} onConfirm={() => { if (deletingTask) deleteTask(deletingTask.id); setDeletingTask(null) }} />
    <ConfirmDialog open={deletingGoal} title="Eliminar objetivo" description="Solo se puede eliminar cuando ya no tiene proyectos relacionados." onClose={() => setDeletingGoal(false)} onConfirm={() => { deleteGoal(goal.id); setDeletingGoal(false) }} />
  </div>
}
