import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import { Button, Modal } from '../../components/common'
import { StatusSelector } from '../../components/common/StatusSelector'
import { TaskDatePicker } from '../../components/common/TaskDatePicker'
import { useFaroStore } from '../../store'
import { useWorkspaces } from '../../hooks/useWorkspaces'
import { isValidDateRange } from '../../lib/planningDates'
import { localDateTimeToTimestamp, timestampToLocalParts } from '../../lib/calendarDates'
import type { Goal, GoalStatus, LifeArea, Priority, Project, ProjectStatus, Task, TaskStatus } from '../../types'

const titleSchema = z.string().trim().min(1, 'El título es obligatorio').max(140)
const areas: Array<[LifeArea, string]> = [['personal', 'Personal'], ['health', 'Salud'], ['finance', 'Finanzas'], ['learning', 'Aprendizaje'], ['nexvora', 'Nexvora'], ['portfolio', 'Portafolio'], ['travel', 'Viajes'], ['relationships', 'Relaciones']]
const priorities: Array<[Priority, string]> = [['critical', 'Crítica'], ['high', 'Alta'], ['medium', 'Media'], ['low', 'Baja']]
const now = () => new Date().toISOString()

interface DialogProps<T> { open: boolean; initial?: T; onClose: () => void }

export function GoalFormDialog({ open, initial, workspaceId: defaultWorkspaceId, onClose }: DialogProps<Goal> & { workspaceId?: string }) {
  const { data: workspaces, loading: workspacesLoading } = useWorkspaces()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [area, setArea] = useState<LifeArea>(initial?.area ?? 'personal')
  const [status, setStatus] = useState<GoalStatus>(initial?.status ?? 'active')
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? '')
  const fallbackWorkspace = workspaces.find((workspace) => workspace.name === 'Personal')?.id ?? workspaces[0]?.id ?? ''
  const [workspaceId, setWorkspaceId] = useState(initial?.workspaceId ?? defaultWorkspaceId ?? '')
  const [error, setError] = useState('')
  const create = useFaroStore((state) => state.createGoal)
  const update = useFaroStore((state) => state.updateGoal)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const parsed = titleSchema.safeParse(title)
    if (!parsed.success) { setError(parsed.error.issues[0].message); return }
    const selectedWorkspace = workspaceId || fallbackWorkspace
    if (!selectedWorkspace) { setError('Selecciona un workspace'); return }
    if (initial) update(initial.id, { title: parsed.data, description: description || undefined, area, status, targetDate: targetDate || undefined, workspaceId: selectedWorkspace })
    else { const timestamp = now(); create({ id: crypto.randomUUID(), title: parsed.data, description: description || undefined, area, status, targetDate: targetDate || undefined, workspaceId: selectedWorkspace, projectIds: [], createdAt: timestamp, updatedAt: timestamp }) }
    onClose()
  }
  return <Modal open={open} title={initial ? 'Editar objetivo' : 'Nuevo objetivo'} onClose={onClose}><form className="planning-form" onSubmit={submit}>
    <label>Título<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} aria-invalid={Boolean(error)} />{error && <span className="field-error">{error}</span>}</label>
    <label>Descripción <span>opcional</span><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <label>Workspace<select required disabled={workspacesLoading} value={workspaceId || fallbackWorkspace} onChange={(event) => setWorkspaceId(event.target.value)}><option value="">Selecciona contexto</option>{workspaces.filter((workspace) => workspace.isActive).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
    <div className="planning-form__grid"><label>Área<select value={area} onChange={(event) => setArea(event.target.value as LifeArea)}>{areas.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Estado<select value={status} onChange={(event) => setStatus(event.target.value as GoalStatus)}><option value="active">Activo</option><option value="paused">En pausa</option><option value="completed">Completado</option></select></label></div>
    <label>Fecha objetivo<input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
    <div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={workspacesLoading}>{initial ? 'Guardar' : 'Crear objetivo'}</Button></div>
  </form></Modal>
}

export function ProjectFormDialog({ open, initial, goalId: defaultGoalId, workspaceId: defaultWorkspaceId, onClose }: DialogProps<Project> & { goalId?: string; workspaceId?: string }) {
  const { data: workspaces, loading: workspacesLoading } = useWorkspaces()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [area, setArea] = useState<LifeArea>(initial?.area ?? 'personal')
  const [status, setStatus] = useState<ProjectStatus>(initial?.status ?? 'planned')
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 'medium')
  const [goalId, setGoalId] = useState(initial?.goalId ?? defaultGoalId ?? '')
  const inheritedWorkspace = useFaroStore.getState().goals.find((goal) => goal.id === (initial?.goalId ?? defaultGoalId))?.workspaceId
  const fallbackWorkspace = workspaces.find((workspace) => workspace.name === 'Personal')?.id ?? workspaces[0]?.id ?? ''
  const [workspaceId, setWorkspaceId] = useState(initial?.workspaceId ?? defaultWorkspaceId ?? inheritedWorkspace ?? '')
  const [startDate, setStartDate] = useState(initial?.startDate ?? '')
  const [endDate, setEndDate] = useState(initial?.endDate ?? '')
  const [error, setError] = useState('')
  const goals = useFaroStore((state) => state.goals)
  const create = useFaroStore((state) => state.createProject)
  const update = useFaroStore((state) => state.updateProject)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const parsed = titleSchema.safeParse(title)
    if (!parsed.success) { setError(parsed.error.issues[0].message); return }
    const selectedWorkspace = workspaceId || fallbackWorkspace
    if (!selectedWorkspace) { setError('Selecciona un workspace'); return }
    if (!isValidDateRange(startDate, endDate)) { setError('La fecha objetivo debe ser posterior al inicio'); return }
    const goal = goals.find((item) => item.id === goalId)
    if (goal?.workspaceId && goal.workspaceId !== selectedWorkspace) { setError('El objetivo y el proyecto deben usar el mismo workspace'); return }
    const values = { title: parsed.data, description: description || undefined, area, status, priority, goalId: goalId || undefined, startDate: startDate || undefined, endDate: endDate || undefined, workspaceId: goal?.workspaceId ?? selectedWorkspace }
    if (initial) update(initial.id, values)
    else { const timestamp = now(); create({ ...values, id: crypto.randomUUID(), createdAt: timestamp, updatedAt: timestamp }) }
    onClose()
  }
  return <Modal open={open} title={initial ? 'Editar proyecto' : 'Nuevo proyecto'} onClose={onClose}><form className="planning-form" onSubmit={submit}>
    <label>Título<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} aria-invalid={Boolean(error)} />{error && <span className="field-error">{error}</span>}</label>
    <label>Descripción <span>opcional</span><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <label>Workspace<select required disabled={workspacesLoading || Boolean(goalId)} value={workspaceId || fallbackWorkspace} onChange={(event) => setWorkspaceId(event.target.value)}><option value="">Selecciona contexto</option>{workspaces.filter((workspace) => workspace.isActive).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
    <div className="planning-form__grid"><label>Área<select value={area} onChange={(event) => setArea(event.target.value as LifeArea)}>{areas.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Prioridad<select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>{priorities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <div className="planning-form__grid"><label>Estado<select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)}><option value="idea">Idea</option><option value="planned">Planeado</option><option value="active">Activo</option><option value="paused">En pausa</option><option value="completed">Completado</option></select></label><label>Objetivo<select value={goalId} onChange={(event) => { const id = event.target.value; setGoalId(id); const goal = goals.find((item) => item.id === id); if (goal?.workspaceId) setWorkspaceId(goal.workspaceId) }}><option value="">Sin objetivo</option>{goals.filter((goal) => !workspaceId || goal.workspaceId === workspaceId).map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label></div>
    <div className="planning-form__grid"><label>Inicio<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>Final<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></div>
    <div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={workspacesLoading}>{initial ? 'Guardar' : 'Crear proyecto'}</Button></div>
  </form></Modal>
}

export function TaskFormDialog({ open, initial, projectId: defaultProjectId, goalId: defaultGoalId, workspaceId: defaultWorkspaceId, dueAt: defaultDueAt, status: defaultStatus, onClose }: DialogProps<Task> & { projectId?: string; goalId?: string; workspaceId?: string; dueAt?: string; status?: TaskStatus }) {
  const { data: workspaces, loading: workspacesLoading } = useWorkspaces()
  const projects = useFaroStore((state) => state.projects)
  const initialProjectId = initial?.projectId ?? defaultProjectId ?? ''
  const projectGoal = projects.find((project) => project.id === initialProjectId)?.goalId
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? initial?.notes ?? '')
  const initialStatus = initial?.status ?? defaultStatus ?? 'todo'
  const [status, setStatus] = useState<TaskStatus>(initialStatus === 'inbox' || initialStatus === 'paused' ? 'todo' : initialStatus)
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 'medium')
  const goalId = initial?.goalId ?? defaultGoalId ?? projectGoal ?? ''
  const initialDue = timestampToLocalParts(initial?.dueAt ?? defaultDueAt)
  const [dueDate, setDueDate] = useState(initialDue.date || initial?.dueDate || '')
  const [dueTime, setDueTime] = useState(initialDue.time)
  const [estimatedMinutes, setEstimatedMinutes] = useState(initial?.estimatedMinutes?.toString() ?? '30')
  const fallbackWorkspace = workspaces.find((workspace) => workspace.name === 'Personal')?.id ?? workspaces[0]?.id ?? ''
  const [workspaceId, setWorkspaceId] = useState(initial?.workspaceId ?? defaultWorkspaceId ?? '')
  const [blockerReason, setBlockerReason] = useState(initial?.blockerReason ?? '')
  const [pausedUntil, setPausedUntil] = useState(initial?.pausedUntil?.slice(0, 10) ?? '')
  const [error, setError] = useState('')
  const create = useFaroStore((state) => state.createTask)
  const update = useFaroStore((state) => state.updateTask)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const parsed = titleSchema.safeParse(title)
    if (!parsed.success) { setError(parsed.error.issues[0].message); return }
    const selectedWorkspace = workspaceId || fallbackWorkspace
    if (!selectedWorkspace) { setError('Selecciona un workspace'); return }
    const workspaceName = workspaces.find((workspace) => workspace.id === selectedWorkspace)?.name.toLowerCase()
    const contextArea: LifeArea = workspaceName === 'nexvora' ? 'nexvora' : workspaceName === 'portfolio' ? 'portfolio' : initial?.area ?? 'personal'
    const relatedProject = projects.find((project) => project.id === initialProjectId && project.workspaceId === selectedWorkspace)
    const values = { title: parsed.data, description: description || undefined, notes: undefined, area: contextArea, status, priority, projectId: relatedProject?.id, goalId: relatedProject ? goalId || undefined : undefined, dueDate: dueDate || undefined, dueAt: dueDate && dueTime ? localDateTimeToTimestamp(dueDate, dueTime) : undefined, estimatedMinutes: Math.max(0, Number(estimatedMinutes) || 0), workspaceId: selectedWorkspace, blockerReason: status === 'blocked' ? blockerReason || undefined : undefined, pausedUntil: status === 'paused' ? pausedUntil || undefined : undefined }
    if (initial) update(initial.id, values)
    else { const timestamp = now(); create({ ...values, id: crypto.randomUUID(), createdAt: timestamp, updatedAt: timestamp }) }
    onClose()
  }
  return <Modal panelClassName="task-form-modal" open={open} title={initial ? 'Editar tarea' : 'Nueva tarea'} onClose={onClose}><form className="planning-form task-form" onSubmit={submit}>
    <label>Título<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} aria-invalid={Boolean(error)} />{error && <span className="field-error">{error}</span>}</label>
    <label>Descripción <span>opcional</span><textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <label>Workspace<select required disabled={workspacesLoading} value={workspaceId || fallbackWorkspace} onChange={(event) => setWorkspaceId(event.target.value)}><option value="">Selecciona contexto</option>{workspaces.filter((workspace) => workspace.isActive).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
    <div className="planning-form__grid"><label>Estado<StatusSelector value={status} onChange={setStatus} /></label><label>Prioridad<select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>{priorities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <div className="planning-form__grid planning-form__grid--schedule"><TaskDatePicker value={dueDate} onChange={(value) => { setDueDate(value); if (!value) setDueTime('') }} /><label>Hora <span>opcional</span><input type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} /></label><label>Estimación (min)<input type="number" min="0" step="5" value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(event.target.value)} /></label></div>
    {status === 'blocked' && <label>Motivo de bloqueo<input value={blockerReason} onChange={(event) => setBlockerReason(event.target.value)} /></label>}
    {status === 'paused' && <TaskDatePicker label="Pausada hasta" value={pausedUntil} onChange={setPausedUntil} />}
    <div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">{initial ? 'Guardar' : 'Crear tarea'}</Button></div>
  </form></Modal>
}
