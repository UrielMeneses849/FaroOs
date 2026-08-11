import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useDroppable, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CalendarDays, CheckCircle2, Clock3, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { StatusSelector } from '../../components/common/StatusSelector'
import type { Project, Task, TaskStatus } from '../../types'

const kanbanColumns: Array<{ id: TaskStatus; label: string }> = [
  { id: 'todo', label: 'Por hacer' }, { id: 'doing', label: 'En progreso' },
  { id: 'blocked', label: 'En revisión' }, { id: 'done', label: 'Completado' },
]

export function TaskKanbanBoard({ tasks, projects, showWorkspace, workspaceName, onMove, onStatus, onAdd, onEdit, onDelete, onAddToSprint }: {
  tasks: Task[]
  projects: Project[]
  showWorkspace: boolean
  workspaceName: (task: Task) => string
  onMove: (taskId: string, targetStatus: TaskStatus, beforeId?: string) => Promise<void>
  onStatus: (task: Task, status: TaskStatus) => void
  onAdd: (status: TaskStatus) => void
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onAddToSprint?: (task: Task, commitment: 'committed' | 'emergent' | 'optional') => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const dragEnd = (event: DragEndEvent) => {
    const taskId = String(event.active.id)
    const overId = event.over?.id ? String(event.over.id) : ''
    if (!overId) return
    const overTask = tasks.find((task) => task.id === overId)
    const targetStatus = overTask?.status ?? (kanbanColumns.some((column) => column.id === overId) ? overId as TaskStatus : undefined)
    if (targetStatus) void onMove(taskId, targetStatus, overTask?.id)
  }
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
    <div className="kanban-board">{kanbanColumns.map((column) => {
      const items = tasks.filter((task) => (task.status === 'inbox' || task.status === 'paused' ? 'todo' : task.status) === column.id)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt.localeCompare(b.createdAt))
      return <KanbanColumn key={column.id} status={column.id} label={column.label} tasks={items} projects={projects} showWorkspace={showWorkspace} workspaceName={workspaceName} onStatus={onStatus} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} onAddToSprint={onAddToSprint} />
    })}</div>
  </DndContext>
}

function KanbanColumn({ status, label, tasks, projects, showWorkspace, workspaceName, onStatus, onAdd, onEdit, onDelete, onAddToSprint }: {
  status: TaskStatus; label: string; tasks: Task[]; projects: Project[]; showWorkspace: boolean
  workspaceName: (task: Task) => string; onStatus: (task: Task, status: TaskStatus) => void
  onAdd: (status: TaskStatus) => void; onEdit: (task: Task) => void; onDelete: (task: Task) => void
  onAddToSprint?: (task: Task, commitment: 'committed' | 'emergent' | 'optional') => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return <section className={`kanban-column ${isOver ? 'kanban-column--over' : ''}`}>
    <header><h2>{label}</h2><span>{tasks.length}</span><button onClick={() => onAdd(status)}><Plus size={13} />Añadir</button></header>
    <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
      <div ref={setNodeRef} className="kanban-column__list">{tasks.map((task) => <KanbanCard key={task.id} task={task} project={projects.find((project) => project.id === task.projectId)} showWorkspace={showWorkspace} workspace={workspaceName(task)} onStatus={onStatus} onEdit={onEdit} onDelete={onDelete} onAddToSprint={onAddToSprint} />)}{!tasks.length && <p>Suelta o añade una tarea.</p>}</div>
    </SortableContext>
  </section>
}

function KanbanCard({ task, project, showWorkspace, workspace, onStatus, onEdit, onDelete, onAddToSprint }: {
  task: Task; project?: Project; showWorkspace: boolean; workspace: string
  onStatus: (task: Task, status: TaskStatus) => void; onEdit: (task: Task) => void; onDelete: (task: Task) => void
  onAddToSprint?: (task: Task, commitment: 'committed' | 'emergent' | 'optional') => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const overdue = task.status !== 'done' && Boolean(task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10))
  return <article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`kanban-card ${isDragging ? 'kanban-card--dragging' : ''}`}>
    <button className={`kanban-card__grip ${task.status === 'done' ? 'kanban-card__grip--done' : ''}`} aria-label={`Mover ${task.title}`} {...attributes} {...listeners}>{task.status === 'done' ? <CheckCircle2 size={16} /> : <GripVertical size={14} />}</button>
    <strong>{task.title}</strong>
    <div className="kanban-card__meta">{showWorkspace && <span>{workspace}</span>}<span className={`priority priority--${task.priority}`}>{task.priority}</span>{project && <span>{project.title}</span>}{task.dueDate && <span className={overdue ? 'overdue' : ''}><CalendarDays size={10} />{task.dueDate}</span>}{task.estimatedMinutes ? <span><Clock3 size={10} />{task.estimatedMinutes} min</span> : null}</div>
    <footer><StatusSelector task={task} value={task.status} onChange={(status) => onStatus(task, status)} />{onAddToSprint && <select aria-label={`Añadir ${task.title} al sprint`} defaultValue="" onChange={(event) => { if (event.target.value) onAddToSprint(task, event.target.value as 'committed' | 'emergent' | 'optional'); event.target.value = '' }}><option value="" disabled>Sprint +</option><option value="committed">Comprometida</option><option value="emergent">Emergente</option><option value="optional">Opcional</option></select>}<button aria-label={`Editar ${task.title}`} onClick={() => onEdit(task)}><Pencil size={13} /></button><button aria-label={`Eliminar ${task.title}`} onClick={() => onDelete(task)}><Trash2 size={13} /></button></footer>
  </article>
}
