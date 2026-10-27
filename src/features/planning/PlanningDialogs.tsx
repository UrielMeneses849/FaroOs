import { useRef, useState, type FormEvent } from 'react'
import { Check, ClipboardCopy } from 'lucide-react'
import { z } from 'zod'
import { Button, Modal } from '../../components/common'
import { StatusSelector } from '../../components/common/StatusSelector'
import { TaskDatePicker } from '../../components/common/TaskDatePicker'
import { useFaroStore } from '../../store'
import { useWorkspaces } from '../../hooks/useWorkspaces'
import { useBacklogSections } from '../../hooks/useBacklogSections'
import { isValidDateRange } from '../../lib/planningDates'
import { localDateTimeToTimestamp, timestampToLocalParts } from '../../lib/calendarDates'
import type { Goal, GoalStatus, LifeArea, Priority, Project, ProjectStatus, Task, TaskStatus, TaskType } from '../../types'
import { taskTypeOptions } from '../backlog/taskClassification'
import { buildDotHandoff, copyText, parseTaskBrief, serializeTaskBrief } from './taskBrief'

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

export function TaskFormDialog({ open, initial, projectId: defaultProjectId, goalId: defaultGoalId, workspaceId: defaultWorkspaceId, dueAt: defaultDueAt, estimatedMinutes: defaultEstimatedMinutes, status: defaultStatus, onSaved, onSavedError, onClose }: DialogProps<Task> & { projectId?: string; goalId?: string; workspaceId?: string; dueAt?: string; estimatedMinutes?: number; status?: TaskStatus; onSaved?: (task: Task) => void | Promise<void>; onSavedError?: (reason: unknown, task: Task) => void }) {
  const { data: workspaces, loading: workspacesLoading } = useWorkspaces()
  const projects = useFaroStore((state) => state.projects)
  const initialProjectId = initial?.projectId ?? defaultProjectId ?? ''
  const initialBrief = parseTaskBrief(initial?.description ?? initial?.notes)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [objective, setObjective] = useState(initialBrief.objective)
  const [currentBehavior, setCurrentBehavior] = useState(initialBrief.currentBehavior)
  const [reproductionSteps, setReproductionSteps] = useState(initialBrief.reproductionSteps)
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(initialBrief.acceptanceCriteria)
  const [references, setReferences] = useState(initialBrief.references)
  const [detailsOpen, setDetailsOpen] = useState(Boolean(initialBrief.currentBehavior || initialBrief.reproductionSteps || initialBrief.acceptanceCriteria || initialBrief.references))
  const initialStatus = initial?.status ?? defaultStatus ?? 'todo'
  const [status, setStatus] = useState<TaskStatus>(initialStatus === 'inbox' || initialStatus === 'paused' ? 'todo' : initialStatus)
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 'medium')
  const [projectId, setProjectId] = useState(initialProjectId)
  const projectGoal = projects.find((project) => project.id === projectId)?.goalId
  const goalId = initial?.goalId ?? defaultGoalId ?? projectGoal ?? ''
  const initialDue = timestampToLocalParts(initial?.dueAt ?? defaultDueAt)
  const [dueDate, setDueDate] = useState(initialDue.date || initial?.dueDate || '')
  const [dueTime, setDueTime] = useState(initialDue.time)
  const [estimatedMinutes, setEstimatedMinutes] = useState(initial?.estimatedMinutes?.toString() ?? defaultEstimatedMinutes?.toString() ?? '30')
  const fallbackWorkspace = workspaces.find((workspace) => workspace.name === 'Personal')?.id ?? workspaces[0]?.id ?? ''
  const [workspaceId, setWorkspaceId] = useState(initial?.workspaceId ?? defaultWorkspaceId ?? '')
  const selectedWorkspace = workspaceId || fallbackWorkspace
  const { data: sections, loading: sectionsLoading } = useBacklogSections(selectedWorkspace)
  const [sectionId, setSectionId] = useState(initial?.sectionId ?? '')
  const [taskType, setTaskType] = useState<TaskType | ''>(initial?.taskType ?? '')
  const [blockerReason, setBlockerReason] = useState(initial?.blockerReason ?? '')
  const [waitingFor, setWaitingFor] = useState(initial?.waitingFor ?? '')
  const [pausedUntil, setPausedUntil] = useState(initial?.pausedUntil?.slice(0, 10) ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const submissionRef = useRef(false)
  const create = useFaroStore((state) => state.createTask)
  const update = useFaroStore((state) => state.updateTask)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (submissionRef.current) return
    const parsed = titleSchema.safeParse(title)
    if (!parsed.success) { setError(parsed.error.issues[0].message); return }
    if (!selectedWorkspace) { setError('Selecciona un workspace'); return }
    const workspaceName = workspaces.find((workspace) => workspace.id === selectedWorkspace)?.name.toLowerCase()
    const contextArea: LifeArea = workspaceName === 'nexvora' ? 'nexvora' : workspaceName === 'portfolio' ? 'portfolio' : initial?.area ?? 'personal'
    const relatedProject = projects.find((project) => project.id === projectId && project.workspaceId === selectedWorkspace)
    const validSectionId = sections.some((section) => section.id === sectionId) ? sectionId : undefined
    const description = serializeTaskBrief({ objective, currentBehavior, reproductionSteps: taskType === 'bug' ? reproductionSteps : '', acceptanceCriteria, references })
    const values = { title: parsed.data, description, notes: undefined, area: contextArea, status, priority, projectId: relatedProject?.id, goalId: relatedProject ? goalId || undefined : undefined, dueDate: dueDate || undefined, dueAt: dueDate && dueTime ? localDateTimeToTimestamp(dueDate, dueTime) : undefined, estimatedMinutes: Math.max(0, Number(estimatedMinutes) || 0), workspaceId: selectedWorkspace, waitingFor: waitingFor.trim() || undefined, blockerReason: status === 'blocked' ? blockerReason || undefined : undefined, pausedUntil: status === 'paused' ? pausedUntil || undefined : undefined, sectionId: validSectionId, taskType: taskType || undefined }
    submissionRef.current = true
    setSaving(true)
    setError('')
    try {
      if (initial) update(initial.id, values)
      else {
        const timestamp = now()
        const task = { ...values, id: crypto.randomUUID(), createdAt: timestamp, updatedAt: timestamp }
        create(task)
        // Calendar side effects (for example, a Focus block) continue in the
        // background. The primary task already exists, so the modal must close
        // immediately and must never expose a second enabled submit.
        if (onSaved) void Promise.resolve()
          .then(() => onSaved(task))
          .catch((reason) => {
            onSavedError?.(reason, task)
            if (import.meta.env.DEV) console.error('[FARO task] Secondary save failed.', reason)
          })
      }
      onClose()
    } catch (reason) {
      submissionRef.current = false
      setSaving(false)
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar la tarea. Intenta nuevamente.')
    }
  }
  const copyHandoff = async () => {
    if (!initial) return
    const text = buildDotHandoff({
      id: initial.id,
      title: title.trim() || initial.title,
      workspace: workspaces.find((workspace) => workspace.id === selectedWorkspace)?.name,
      section: sections.find((section) => section.id === sectionId)?.name,
      project: projects.find((project) => project.id === projectId)?.title,
      taskType,
      status,
      priority,
      brief: { objective, currentBehavior, reproductionSteps: taskType === 'bug' ? reproductionSteps : '', acceptanceCriteria, references },
    })
    try {
      await copyText(text)
      setCopyState('copied')
    } catch {
      setCopyState('error')
    }
  }
  return <Modal panelClassName="task-form-modal" open={open} title={initial ? 'Editar tarea' : 'Nueva tarea'} onClose={onClose}><form className="planning-form task-form" onSubmit={submit}>
    <label>Título<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} aria-invalid={Boolean(error)} />{error && <span className="field-error">{error}</span>}</label>
    <div className="task-brief-guide"><strong>Lo mínimo: un título claro.</strong><span>Añade el resultado esperado para que dot pueda ejecutar con menos preguntas. El resto es opcional y aparece solo cuando lo necesitas.</span></div>
    <label>Objetivo / resultado esperado <span>recomendado</span><textarea rows={2} value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Ej. Al limpiar filtros, vaciar la selección y mantener Explorer activo." /></label>
    <label>Workspace<select required disabled={workspacesLoading} value={selectedWorkspace} onChange={(event) => { setWorkspaceId(event.target.value); setSectionId(''); setProjectId('') }}><option value="">Selecciona contexto</option>{workspaces.filter((workspace) => workspace.isActive).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
    <div className="planning-form__grid planning-form__grid--classification"><label>Sección <span>opcional</span><select disabled={sectionsLoading || !selectedWorkspace} value={sectionId} onChange={(event) => setSectionId(event.target.value)}><option value="">Sin sección</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label><label>Tipo de tarea <span>opcional</span><select value={taskType} onChange={(event) => setTaskType(event.target.value as TaskType | '')}><option value="">Sin clasificar</option>{taskTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div>
    <label>Proyecto <span>opcional</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Sin proyecto</option>{projects.filter((project) => project.workspaceId === selectedWorkspace).map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
    <details className="task-brief-details" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
      <summary>Detalles para ejecutar <span>opcionales</span></summary>
      <div className="task-brief-details__body">
        <label>Contexto / comportamiento actual <span>qué ocurre hoy</span><textarea rows={3} value={currentBehavior} onChange={(event) => setCurrentBehavior(event.target.value)} placeholder="Qué ves, qué debería conservarse y cualquier restricción relevante." /></label>
        {taskType === 'bug' && <label>Pasos para reproducir <span>solo para bugs</span><textarea rows={3} value={reproductionSteps} onChange={(event) => setReproductionSteps(event.target.value)} placeholder={'1. Abrir…\n2. Seleccionar…\n3. Observar…'} /></label>}
        <label>Criterios de aceptación <span>cómo sabremos que terminó</span><textarea rows={3} value={acceptanceCriteria} onChange={(event) => setAcceptanceCriteria(event.target.value)} placeholder={'- La selección queda vacía\n- Explorer permanece activo\n- La prueba automatizada pasa'} /></label>
        <label>Referencias / capturas <span>enlaces o rutas, una por línea</span><textarea rows={2} value={references} onChange={(event) => setReferences(event.target.value)} placeholder="https://… o /ruta/a/captura.png" /></label>
      </div>
    </details>
    <div className="planning-form__grid"><label>Estado<StatusSelector value={status} onChange={setStatus} /></label><label>Prioridad<select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>{priorities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <div className="planning-form__grid planning-form__grid--schedule"><TaskDatePicker value={dueDate} onChange={(value) => { setDueDate(value); if (!value) setDueTime('') }} /><label>Hora <span>opcional</span><input type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} /></label><label>Estimación (min)<input type="number" min="0" step="5" value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(event.target.value)} /></label></div>
    {status === 'blocked' && <label>Notas de revisión <span>opcional</span><input value={blockerReason} onChange={(event) => setBlockerReason(event.target.value)} placeholder="Ej. Validar cambios antes de cerrar" /></label>}
    {status === 'waiting' && <label>¿Qué o a quién estás esperando? <span>opcional</span><input value={waitingFor} onChange={(event) => setWaitingFor(event.target.value)} placeholder="Ej. Ana · validar el reporte" /></label>}
    {status === 'paused' && <TaskDatePicker label="Pausada hasta" value={pausedUntil} onChange={setPausedUntil} />}
    {initial && <div className="task-dot-handoff"><Button type="button" variant="secondary" icon={copyState === 'copied' ? <Check size={14} /> : <ClipboardCopy size={14} />} onClick={() => void copyHandoff()}>{copyState === 'copied' ? 'Encargo copiado' : 'Copiar encargo para dot'}</Button><span role="status">{copyState === 'error' ? 'No se pudo copiar. Revisa el permiso del portapapeles.' : 'Prepara el encargo; no lo envía ni lo inicia.'}</span></div>}
    <div className="modal-actions"><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancelar</Button><Button type="submit" loading={saving}>{saving ? initial ? 'Guardando…' : 'Creando…' : initial ? 'Guardar' : 'Crear tarea'}</Button></div>
  </form></Modal>
}
