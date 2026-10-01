/* eslint-disable react-refresh/only-export-components -- pure ordering helpers are shared with focused tests */
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { format, isToday, isYesterday, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarDays, CheckCircle2, Clock3, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { StatusSelector } from '../../components/common/StatusSelector'
import type { Project, Task, TaskStatus } from '../../types'

const kanbanColumns: Array<{ id: TaskStatus; label: string }> = [
  { id: 'todo', label: 'Por hacer' }, { id: 'doing', label: 'En progreso' },
  { id: 'blocked', label: 'En revisión' }, { id: 'done', label: 'Completado' },
]

const displayStatus = (status: TaskStatus) => status === 'inbox' || status === 'paused' ? 'todo' : status

type CompletedTaskGroup = { key: string; label: string; tasks: Task[] }

const timestampOf = (value?: string) => {
  if (!value) return 0
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

/**
 * A prior data migration assigned one identical `completedAt` to large batches
 * of already-completed tasks. That timestamp describes the migration, not the
 * moment a person finished each task. When an older `updatedAt` remains, it is
 * the best available ordering signal. When it was overwritten too, we do not
 * invent a date: those tasks go under a clearly labelled historic bucket.
 */
const resolvedCompletionMoments = (tasks: Task[]) => {
  const tasksByRecordedCompletion = new Map<string, Task[]>()
  for (const task of tasks) {
    if (!task.completedAt) continue
    const batch = tasksByRecordedCompletion.get(task.completedAt) ?? []
    batch.push(task)
    tasksByRecordedCompletion.set(task.completedAt, batch)
  }

  const migrationBatchTimestamps = new Set([...tasksByRecordedCompletion.entries()]
    .filter(([completedAt, batch]) => {
      const recordedAt = timestampOf(completedAt)
      // Three genuine closes may happen together during a cleanup session.
      // A large exact timestamp batch is the legacy migration signature.
      return batch.length >= 10 && recordedAt > 0
    })
    .map(([completedAt]) => completedAt))

  return new Map(tasks.map((task) => {
    const recordedAt = timestampOf(task.completedAt)
    const belongsToMigrationBatch = Boolean(task.completedAt) && migrationBatchTimestamps.has(task.completedAt!)
    const historicUpdate = timestampOf(task.updatedAt) + 60_000 < recordedAt ? task.updatedAt : undefined
    const resolved = belongsToMigrationBatch
      ? historicUpdate
      : task.completedAt ?? task.updatedAt ?? task.createdAt
    return [task.id, resolved] as const
  }))
}

const completionTimestamp = (task: Task, moments: Map<string, string | undefined>) => timestampOf(moments.get(task.id))

const completionDateLabel = (value?: string) => {
  if (!value) return 'Histórico sin fecha de cierre'
  const date = parseISO(value)
  if (Number.isNaN(date.getTime())) return 'Sin fecha de cierre'
  if (isToday(date)) return 'Completadas hoy'
  if (isYesterday(date)) return 'Completadas ayer'
  return `Completadas el ${format(date, "EEEE d 'de' MMMM", { locale: es })}`
}

export function sortCompletedTasks(tasks: Task[]) {
  const moments = resolvedCompletionMoments(tasks)
  return [...tasks].sort((left, right) => completionTimestamp(right, moments) - completionTimestamp(left, moments)
    || right.updatedAt.localeCompare(left.updatedAt)
    || right.createdAt.localeCompare(left.createdAt))
}

export function groupCompletedTasks(tasks: Task[]): CompletedTaskGroup[] {
  const moments = resolvedCompletionMoments(tasks)
  const groups = new Map<string, CompletedTaskGroup>()
  for (const task of [...tasks].sort((left, right) => completionTimestamp(right, moments) - completionTimestamp(left, moments)
    || right.updatedAt.localeCompare(left.updatedAt)
    || right.createdAt.localeCompare(left.createdAt))) {
    const value = moments.get(task.id)
    const parsed = value ? parseISO(value) : undefined
    const key = parsed && !Number.isNaN(parsed.getTime()) ? format(parsed, 'yyyy-MM-dd') : 'unknown'
    const group = groups.get(key) ?? { key, label: completionDateLabel(value), tasks: [] }
    group.tasks.push(task)
    groups.set(key, group)
  }
  return [...groups.values()]
}

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
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [overStatus, setOverStatus] = useState<TaskStatus | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const targetStatusFor = (id: string) => {
    const task = tasks.find((candidate) => candidate.id === id)
    return task ? displayStatus(task.status) : kanbanColumns.some((column) => column.id === id) ? id as TaskStatus : undefined
  }
  const dragStart = (event: DragStartEvent) => {
    setActiveTask(tasks.find((task) => task.id === String(event.active.id)) ?? null)
  }
  const dragOver = (event: DragOverEvent) => {
    setOverStatus(event.over?.id ? targetStatusFor(String(event.over.id)) ?? null : null)
  }
  const finishDrag = () => {
    setOverStatus(null)
    window.setTimeout(() => setActiveTask(null), 180)
  }
  const dragEnd = (event: DragEndEvent) => {
    const taskId = String(event.active.id)
    const overId = event.over?.id ? String(event.over.id) : ''
    if (!overId) { finishDrag(); return }
    const overTask = tasks.find((task) => task.id === overId)
    const targetStatus = overTask ? displayStatus(overTask.status) : targetStatusFor(overId)
    if (targetStatus) void onMove(taskId, targetStatus, overTask?.id)
    finishDrag()
  }
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={dragStart} onDragOver={dragOver} onDragCancel={finishDrag} onDragEnd={dragEnd}>
    <div className="kanban-board">{kanbanColumns.map((column) => {
      const items = tasks.filter((task) => displayStatus(task.status) === column.id)
      const sortedItems = column.id === 'done'
        ? sortCompletedTasks(items)
        : items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt.localeCompare(b.createdAt))
      return <KanbanColumn key={column.id} status={column.id} label={column.label} tasks={sortedItems} projects={projects} showWorkspace={showWorkspace} workspaceName={workspaceName} isDropTarget={Boolean(activeTask && overStatus === column.id && displayStatus(activeTask.status) !== column.id)} onStatus={onStatus} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} onAddToSprint={onAddToSprint} />
    })}</div>
    <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }}>
      {activeTask && <KanbanDragPreview task={activeTask} workspace={workspaceName(activeTask)} showWorkspace={showWorkspace} />}
    </DragOverlay>
  </DndContext>
}

function KanbanColumn({ status, label, tasks, projects, showWorkspace, workspaceName, isDropTarget, onStatus, onAdd, onEdit, onDelete, onAddToSprint }: {
  status: TaskStatus; label: string; tasks: Task[]; projects: Project[]; showWorkspace: boolean
  workspaceName: (task: Task) => string; onStatus: (task: Task, status: TaskStatus) => void
  isDropTarget: boolean
  onAdd: (status: TaskStatus) => void; onEdit: (task: Task) => void; onDelete: (task: Task) => void
  onAddToSprint?: (task: Task, commitment: 'committed' | 'emergent' | 'optional') => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const completionGroups = status === 'done' ? groupCompletedTasks(tasks) : []
  return <section className={`kanban-column ${isOver ? 'kanban-column--over' : ''}`}>
    <header><h2>{label}</h2><span>{tasks.length}</span><button onClick={() => onAdd(status)}><Plus size={13} />Añadir</button></header>
    <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
      <div ref={setNodeRef} className="kanban-column__list">
        {isDropTarget && <div className="kanban-drop-placeholder" aria-hidden="true" />}
        {status === 'done'
          ? completionGroups.map((group) => <section key={group.key} className="kanban-completion-group"><header><span>{group.label}</span><small>{group.tasks.length}</small></header>{group.tasks.map((task) => <KanbanCard key={task.id} task={task} project={projects.find((project) => project.id === task.projectId)} showWorkspace={showWorkspace} workspace={workspaceName(task)} onStatus={onStatus} onEdit={onEdit} onDelete={onDelete} onAddToSprint={onAddToSprint} />)}</section>)
          : tasks.map((task) => <KanbanCard key={task.id} task={task} project={projects.find((project) => project.id === task.projectId)} showWorkspace={showWorkspace} workspace={workspaceName(task)} onStatus={onStatus} onEdit={onEdit} onDelete={onDelete} onAddToSprint={onAddToSprint} />)}
        {!tasks.length && !isDropTarget && <p>Suelta o añade una tarea.</p>}
      </div>
    </SortableContext>
  </section>
}

function KanbanDragPreview({ task, workspace, showWorkspace }: { task: Task; workspace: string; showWorkspace: boolean }) {
  return <article className="kanban-card kanban-card--drag-overlay" aria-hidden="true">
    <span className={`kanban-card__grip ${task.status === 'done' ? 'kanban-card__grip--done' : ''}`}>{task.status === 'done' ? <CheckCircle2 size={16} /> : <GripVertical size={14} />}</span>
    <strong>{task.title}</strong>
    <div className="kanban-card__meta">{showWorkspace && <span>{workspace}</span>}<span className={`priority priority--${task.priority}`}>{task.priority}</span>{task.dueDate && <span><CalendarDays size={10} />{task.dueDate}</span>}{task.estimatedMinutes ? <span><Clock3 size={10} />{task.estimatedMinutes} min</span> : null}</div>
  </article>
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
