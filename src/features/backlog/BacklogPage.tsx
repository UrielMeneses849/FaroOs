import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, ConfirmDialog, EmptyState } from '../../components/common'
import { PageHeader } from '../../components/layout'
import { TaskFormDialog } from '../planning/PlanningDialogs'
import { useAuth } from '../../hooks/auth'
import { useWorkspaces } from '../../hooks/useWorkspaces'
import { useSprints } from '../../hooks/useSprints'
import { taskRepository } from '../../repositories/taskRepository'
import { sprintRepository } from '../../repositories/sprintRepository'
import { useFaroStore } from '../../store'
import type { BacklogKind, Priority, Task, TaskStatus } from '../../types'
import type { BacklogItem, SortKey } from './backlogTypes'
import { buildBacklogItems } from './backlogUtils'
import { EditItemDialog } from './EditItemDialog'
import { WorkspaceOverviewGrid, type WorkspaceMetrics } from './WorkspaceOverviewGrid'
import { TaskKanbanBoard } from './TaskKanbanBoard'

type Bucket = 'todo' | 'doing' | 'blocked' | 'done'
const bucketOf = (item: BacklogItem): Bucket => {
  if (item.status === 'done' || item.status === 'completed' || item.status === 'archived') return 'done'
  if (item.status === 'paused' || item.status === 'inbox') return 'todo'
  if (item.status === 'blocked') return 'blocked'
  if (item.status === 'doing' || item.status === 'active') return 'doing'
  if (item.status === 'todo' || item.status === 'planned') return 'todo'
  return 'todo'
}

export function BacklogPage() {
  const { user } = useAuth()
  const { data: workspaces, loading, error, refresh } = useWorkspaces()
  const { data: sprintData, refresh: refreshSprints } = useSprints()
  const ideas = useFaroStore((state) => state.ideas)
  const tasks = useFaroStore((state) => state.tasks)
  const projects = useFaroStore((state) => state.projects)
  const goals = useFaroStore((state) => state.goals)
  const deleteIdea = useFaroStore((state) => state.deleteIdea)
  const deleteTask = useFaroStore((state) => state.deleteTask)
  const deleteProject = useFaroStore((state) => state.deleteProject)
  const deleteGoal = useFaroStore((state) => state.deleteGoal)
  const [params, setParams] = useSearchParams()
  const [query] = useState('')
  const [kind] = useState<BacklogKind | 'all'>('all')
  const [priority] = useState<Priority | 'all'>('all')
  const [status] = useState('all')
  const [sort] = useState<SortKey>('created')
  const [dateFilter] = useState<'all' | 'overdue' | 'undated'>('all')
  const [projectFilter] = useState('all')
  const [creatingStatus, setCreatingStatus] = useState<TaskStatus>()
  const [feedback, setFeedback] = useState('')
  const [editing, setEditing] = useState<BacklogItem | null>(null)
  const [deleting, setDeleting] = useState<BacklogItem | null>(null)
  const activeWorkspace = params.get('workspace') ?? sessionStorage.getItem('faro-backlog-workspace') ?? 'all'
  const activeWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspace.isActive),
    [workspaces],
  )
  const activeSprint = sprintData.sprints.find((item) => item.status === 'active')
  const allItems = useMemo(() => buildBacklogItems({ ideas, tasks, projects, goals }), [goals, ideas, projects, tasks])
  const workspaceFor = useCallback((item: BacklogItem) => item.workspaceId
    ?? activeWorkspaces.find((workspace) => ['bbva', 'bimsa'].includes(workspace.name.toLowerCase()) && item.title.toLowerCase().includes(workspace.name.toLowerCase()))?.id
    ?? activeWorkspaces.find((workspace) => workspace.name.toLowerCase() === item.area)?.id
    ?? activeWorkspaces.find((workspace) => workspace.name === 'Personal')?.id,
  [activeWorkspaces])
  const chooseWorkspace = (id: string) => {
    sessionStorage.setItem('faro-backlog-workspace', id)
    setParams(id === 'all' ? {} : { workspace: id }, { replace: true })
  }
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es')
    const priorityWeight = { critical: 4, high: 3, medium: 2, low: 1 }
    return allItems.filter((item) => !item.archivedAt
      && (activeWorkspace === 'all' || workspaceFor(item) === activeWorkspace)
      && (kind === 'all' || item.kind === kind)
      && (priority === 'all' || item.priority === priority)
      && (status === 'all' || bucketOf(item) === status)
      && (projectFilter === 'all' || item.projectId === projectFilter)
      && (dateFilter !== 'overdue' || Boolean(item.date && item.date < new Date().toISOString().slice(0, 10)))
      && (dateFilter !== 'undated' || !item.date)
      && (!normalized || `${item.title} ${item.description ?? ''}`.toLocaleLowerCase('es').includes(normalized)))
      .sort((left, right) => sort === 'due' ? (left.date ?? '9999').localeCompare(right.date ?? '9999') : sort === 'priority' ? priorityWeight[right.priority ?? 'low'] - priorityWeight[left.priority ?? 'low'] : right.createdAt.localeCompare(left.createdAt))
  }, [activeWorkspace, allItems, dateFilter, kind, priority, projectFilter, query, sort, status, workspaceFor])
  const metrics = useMemo(() => Object.fromEntries(activeWorkspaces.map((workspace) => {
    const items = allItems.filter((item) => workspaceFor(item) === workspace.id && !item.archivedAt)
    const complete = items.filter((item) => bucketOf(item) === 'done').length
    return [workspace.id, { pending: items.length - complete, tasks: items.filter((item) => item.kind === 'task').length, projects: items.filter((item) => item.kind === 'project').length, goals: items.filter((item) => item.kind === 'goal').length } satisfies WorkspaceMetrics]
  })), [activeWorkspaces, allItems, workspaceFor])
  const remove = () => {
    if (!deleting) return
    if (deleting.kind === 'idea') deleteIdea(deleting.id)
    if (deleting.kind === 'task') deleteTask(deleting.id)
    if (deleting.kind === 'project') deleteProject(deleting.id)
    if (deleting.kind === 'goal') deleteGoal(deleting.id)
    setDeleting(null)
  }
  const taskWorkspaceName = (task: Task) => activeWorkspaces.find((workspace) => workspace.id === task.workspaceId)?.name ?? 'Personal'
  const kanbanTasks = filtered.filter((item) => item.kind === 'task')
    .map((item) => tasks.find((task) => task.id === item.id)).filter((task): task is Task => Boolean(task))
  const changeStatus = (task: Task, nextStatus: TaskStatus) => useFaroStore.getState().updateTask(task.id, { status: nextStatus })
  const moveTask = async (taskId: string, targetStatus: TaskStatus, beforeId?: string) => {
    if (!user) return
    const previous = useFaroStore.getState().tasks
    const task = previous.find((item) => item.id === taskId)
    if (!task) return
    const targetTasks = previous.filter((item) => item.id !== taskId && item.status === targetStatus && item.workspaceId === task.workspaceId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    const beforeIndex = beforeId ? targetTasks.findIndex((item) => item.id === beforeId) : -1
    const previousOrder = beforeIndex > 0 ? targetTasks[beforeIndex - 1]?.sortOrder ?? 0 : beforeIndex === 0 ? 0 : targetTasks.at(-1)?.sortOrder ?? 0
    const nextOrder = beforeIndex >= 0 ? targetTasks[beforeIndex]?.sortOrder ?? previousOrder + 2000 : previousOrder + 2000
    const sortOrder = beforeIndex >= 0 ? (previousOrder + nextOrder) / 2 : nextOrder
    const optimistic = { ...task, status: targetStatus, sortOrder, updatedAt: new Date().toISOString() }
    useFaroStore.setState((state) => ({ tasks: state.tasks.map((item) => item.id === taskId ? optimistic : item) }))
    try { await taskRepository.update(optimistic, user.id); setFeedback('Tarea movida.') }
    catch (reason) {
      useFaroStore.setState({ tasks: previous })
      setFeedback(reason instanceof Error ? reason.message : 'No se pudo mover la tarea. Se restauró su posición.')
    }
  }
  if (loading && !workspaces.length) return <div className="page"><div className="planning-skeleton" role="status">Preparando workspaces…</div></div>
  if (error && !workspaces.length) return <div className="page"><EmptyState title="No pudimos cargar los workspaces" description={error} action={<Button onClick={refresh}>Reintentar</Button>} /></div>
  return <div className="page workspace-backlog"><PageHeader eyebrow="Contextos de trabajo" title="Backlog" description="Organiza lo pendiente desde el lugar donde realmente ocurre." />
    <WorkspaceOverviewGrid workspaces={activeWorkspaces} activeId={activeWorkspace} metrics={metrics} onSelect={chooseWorkspace} />
    {feedback && <div className="kanban-feedback" role="status">{feedback}<button onClick={() => setFeedback('')}>×</button></div>}
    <TaskKanbanBoard tasks={kanbanTasks} projects={projects} showWorkspace={activeWorkspace === 'all'} workspaceName={taskWorkspaceName} onMove={moveTask} onStatus={changeStatus} onAdd={setCreatingStatus} onEdit={(task) => setEditing(allItems.find((item) => item.kind === 'task' && item.id === task.id) ?? null)} onDelete={(task) => setDeleting(allItems.find((item) => item.kind === 'task' && item.id === task.id) ?? null)} onAddToSprint={activeSprint && user ? async (task, commitment) => { await sprintRepository.addTask(activeSprint.id, task.id, commitment, user.id); await refreshSprints(); setFeedback('Tarea añadida al sprint.') } : undefined} />
    {creatingStatus && <TaskFormDialog open status={creatingStatus} workspaceId={activeWorkspace === 'all' ? activeWorkspaces.find((workspace) => workspace.name === 'Personal')?.id : activeWorkspace} onClose={() => setCreatingStatus(undefined)} />}
    {editing?.kind === 'task' ? <TaskFormDialog open initial={tasks.find((task) => task.id === editing.id)} onClose={() => setEditing(null)} /> : editing && <EditItemDialog item={editing} onClose={() => setEditing(null)} />}
    <ConfirmDialog open={Boolean(deleting)} title={`Eliminar ${deleting?.title ?? 'elemento'}`} description="Esta acción no se puede deshacer." onClose={() => setDeleting(null)} onConfirm={remove} />
  </div>
}
