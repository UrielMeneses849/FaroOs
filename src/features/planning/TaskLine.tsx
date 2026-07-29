import { addDays, format } from 'date-fns'
import { Check, Clock3, FolderKanban, Pencil, Target, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AreaBadge } from '../../components/common'
import { StatusSelector } from '../../components/common/StatusSelector'
import { useFaroStore } from '../../store'
import type { Task } from '../../types'

export function TaskLine({ task, onEdit, onDelete, showArea = true }: { task: Task; onEdit?: () => void; onDelete?: () => void; showArea?: boolean }) {
  const updateTask = useFaroStore((state) => state.updateTask)
  const project = useFaroStore((state) => state.projects.find((item) => item.id === task.projectId))
  const goal = useFaroStore((state) => state.goals.find((item) => item.id === (task.goalId ?? project?.goalId)))
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd')
  return <article className={`planning-task ${task.status === 'done' ? 'planning-task--done' : ''}`}>
    <button className="task-complete" aria-label={task.status === 'done' ? `Reabrir ${task.title}` : `Completar ${task.title}`} onClick={() => updateTask(task.id, { status: task.status === 'done' ? 'todo' : 'done' })}><Check size={15} /></button>
    <div className="planning-task__body"><h3>{task.title}</h3><div className="planning-task__meta"><StatusSelector task={task} value={task.status} onChange={(status) => updateTask(task.id, { status })} />{showArea && <AreaBadge area={task.area} />}<span><Clock3 size={12} />{task.estimatedMinutes ?? 0} min</span>{task.dueDate && <span>{task.dueDate}</span>}</div>
      {(project || goal) && <div className="planning-task__links">{project && <Link to={`/projects/${project.id}`}><FolderKanban size={12} />{project.title}</Link>}{goal && <Link to={`/goals/${goal.id}`}><Target size={12} />{goal.title}</Link>}</div>}
    </div>
    <div className="planning-task__actions"><button onClick={() => updateTask(task.id, { dueDate: tomorrow, status: task.status === 'done' ? 'done' : 'todo' })}>Mañana</button>{onEdit && <button aria-label={`Editar ${task.title}`} onClick={onEdit}><Pencil size={14} /></button>}{onDelete && <button aria-label={`Eliminar ${task.title}`} onClick={onDelete}><Trash2 size={14} /></button>}</div>
  </article>
}
