import { CalendarDays, Pencil, Trash2 } from 'lucide-react'
import { StatusBadge } from '../../components/common'
import { StatusSelector } from '../../components/common/StatusSelector'
import { useFaroStore } from '../../store'
import type { BacklogItem } from './backlogTypes'

const labels = { idea: 'Idea', task: 'Tarea', project: 'Proyecto', goal: 'Objetivo' }
export function BacklogItemRow({ item, workspace, onEdit, onDelete }: { item: BacklogItem; workspace: string; onEdit: () => void; onDelete: () => void }) {
  const task = useFaroStore((state) => item.kind === 'task' ? state.tasks.find((candidate) => candidate.id === item.id) : undefined)
  const updateTask = useFaroStore((state) => state.updateTask)
  return <article className="workspace-backlog-row"><span className={`workspace-backlog-row__kind workspace-backlog-row__kind--${item.kind}`}>{labels[item.kind]}</span><div><strong>{item.title}</strong><small>{workspace}{item.date && <> · <CalendarDays size={10} />{item.date}</>}</small></div>{item.priority && <span className={`priority priority--${item.priority}`}>{item.priority}</span>}{task ? <StatusSelector task={task} value={task.status} onChange={(status) => updateTask(task.id, { status })} /> : <StatusBadge status={item.status as never} />}<nav><button aria-label={`Editar ${item.title}`} onClick={onEdit}><Pencil size={13} /></button><button aria-label={`Eliminar ${item.title}`} onClick={onDelete}><Trash2 size={13} /></button></nav></article>
}
