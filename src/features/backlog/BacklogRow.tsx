import { Archive, ArrowRight, Calendar, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { AreaBadge, StatusBadge } from '../../components/common'
import { StatusSelector } from '../../components/common/StatusSelector'
import { useFaroStore } from '../../store'
import type { BacklogItem } from './backlogTypes'

const kindNames = { idea: 'Idea', task: 'Tarea', project: 'Proyecto', goal: 'Objetivo' }
const priorityNames = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' }

export function BacklogRow({ item, selected, projectName, goalName, onSelect, onEdit, onDelete, onConvert, onArchive }: { item: BacklogItem; selected: boolean; projectName?: string; goalName?: string; onSelect: () => void; onEdit: () => void; onDelete: () => void; onConvert: () => void; onArchive: () => void }) {
  const updateTask = useFaroStore((state) => state.updateTask)
  const task = useFaroStore((state) => item.kind === 'task' ? state.tasks.find((candidate) => candidate.id === item.id) : undefined)
  return (
    <article className={`backlog-row ${selected ? 'backlog-row--selected' : ''}`}>
      <label className="row-checkbox"><span className="sr-only">Seleccionar {item.title}</span><input type="checkbox" checked={selected} onChange={onSelect} /></label>
      <div className="backlog-row__kind" data-kind={item.kind}><span>{kindNames[item.kind]}</span></div>
      <div className="backlog-row__main">
        <h3>{item.title}</h3>
        {item.description && <p>{item.description}</p>}
        <div className="backlog-row__meta"><AreaBadge area={item.area} />{task ? <StatusSelector task={task} value={task.status} onChange={(status) => updateTask(task.id, { status })} /> : <StatusBadge status={item.status as never} />}{item.priority && <span className={`priority priority--${item.priority}`}>{priorityNames[item.priority]}</span>}{item.date && <span><Calendar size={12} />{item.date}</span>}</div>
        {(projectName || goalName) && <div className="backlog-row__relations"><span>Vinculado</span>{goalName && <span>{goalName}</span>}{projectName && <><ArrowRight size={11} /><span>{projectName}</span></>}</div>}
      </div>
      <div className="backlog-row__actions">
        {item.kind === 'idea' && <button onClick={onConvert} aria-label={`Convertir ${item.title}`} title="Convertir"><ArrowRight size={16} /></button>}
        <button onClick={onEdit} aria-label={`Editar ${item.title}`} title="Editar"><Pencil size={15} /></button>
        {!item.archivedAt && <button onClick={onArchive} aria-label={`Archivar ${item.title}`} title="Archivar"><Archive size={15} /></button>}
        <button onClick={onDelete} aria-label={`Eliminar ${item.title}`} title="Eliminar"><Trash2 size={15} /></button>
        <MoreHorizontal className="row-more" size={16} aria-hidden="true" />
      </div>
    </article>
  )
}
