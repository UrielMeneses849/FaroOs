import { Check, Flag, FolderKanban, Lightbulb, Target, Zap } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button, Modal } from '../../components/common'
import { useFaroStore } from '../../store'
import type { BacklogKind, LifeArea, Priority } from '../../types'
import { captureSchema, type CaptureValues } from './captureSchema'

const kindOptions: Array<{ value: BacklogKind; label: string; icon: typeof Lightbulb }> = [
  { value: 'idea', label: 'Idea', icon: Lightbulb },
  { value: 'task', label: 'Tarea', icon: Check },
  { value: 'project', label: 'Proyecto', icon: FolderKanban },
  { value: 'goal', label: 'Objetivo', icon: Target },
]
const areas: Array<{ value: LifeArea; label: string }> = [
  { value: 'personal', label: 'Personal' }, { value: 'health', label: 'Salud' },
  { value: 'finance', label: 'Finanzas' }, { value: 'learning', label: 'Aprendizaje' },
  { value: 'nexvora', label: 'Nexvora' }, { value: 'portfolio', label: 'Portafolio' },
  { value: 'travel', label: 'Viajes' }, { value: 'relationships', label: 'Relaciones' },
]
const priorities: Array<{ value: Priority; label: string }> = [
  { value: 'low', label: 'Baja' }, { value: 'medium', label: 'Media' }, { value: 'high', label: 'Alta' },
]
const initialValues: CaptureValues = { title: '', kind: 'idea', area: 'personal', description: '', priority: 'medium', date: '', projectId: '', goalId: '' }

export function QuickCaptureDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [values, setValues] = useState<CaptureValues>(initialValues)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const projects = useFaroStore((state) => state.projects)
  const goals = useFaroStore((state) => state.goals)
  const createIdea = useFaroStore((state) => state.createIdea)
  const createTask = useFaroStore((state) => state.createTask)
  const createProject = useFaroStore((state) => state.createProject)
  const createGoal = useFaroStore((state) => state.createGoal)

  const set = <K extends keyof CaptureValues>(key: K, value: CaptureValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const parsed = captureSchema.safeParse(values)
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])))
      return
    }
    const data = parsed.data
    const now = new Date().toISOString()
    const base = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, title: data.title, area: data.area }
    const description = data.description || undefined
    const projectId = data.projectId || undefined
    const goalId = data.goalId || undefined
    if (data.kind === 'idea') createIdea({ ...base, description, status: 'inbox', date: data.date || undefined, projectId, goalId })
    if (data.kind === 'task') createTask({ ...base, notes: description, status: 'todo', priority: data.priority ?? 'medium', dueDate: data.date || undefined, projectId, goalId })
    if (data.kind === 'project') createProject({ ...base, description, status: 'idea', priority: data.priority ?? 'medium', endDate: data.date || undefined, goalId })
    if (data.kind === 'goal') createGoal({ ...base, description, status: 'active', targetDate: data.date || undefined, projectIds: [] })
    setErrors({})
    setSaved(true)
    window.setTimeout(onClose, 650)
  }

  return (
    <Modal open={open} title="Captura rápida" onClose={onClose}>
      {saved ? (
        <div className="capture-success" role="status"><div><Check /></div><strong>Capturado</strong><span>Ya está seguro en tu backlog.</span></div>
      ) : (
        <form className="capture-form" onSubmit={submit}>
          <label className="capture-title">
            <span className="sr-only">Título</span>
            <Zap size={18} aria-hidden="true" />
            <input autoFocus value={values.title} onChange={(event) => set('title', event.target.value)} placeholder="¿Qué tienes en mente?" aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? 'capture-title-error' : undefined} />
          </label>
          {errors.title && <span id="capture-title-error" className="field-error">{errors.title}</span>}
          <fieldset className="capture-kind"><legend>Tipo de captura</legend>{kindOptions.map(({ value, label, icon: Icon }) => <button key={value} type="button" className={values.kind === value ? 'active' : ''} onClick={() => set('kind', value)} aria-pressed={values.kind === value}><Icon size={15} />{label}</button>)}</fieldset>
          <div className="capture-grid">
            <label>Área<select value={values.area} onChange={(event) => set('area', event.target.value as LifeArea)}>{areas.map((area) => <option key={area.value} value={area.value}>{area.label}</option>)}</select></label>
            {(values.kind === 'task' || values.kind === 'project') && <label>Prioridad<select value={values.priority} onChange={(event) => set('priority', event.target.value as Priority)}>{priorities.map((priority) => <option key={priority.value} value={priority.value}>{priority.label}</option>)}</select></label>}
            <label>{values.kind === 'goal' ? 'Fecha objetivo' : 'Fecha'}<input type="date" value={values.date} onChange={(event) => set('date', event.target.value)} /></label>
          </div>
          <label className="capture-description">Descripción <span>opcional</span><textarea value={values.description} onChange={(event) => set('description', event.target.value)} placeholder="Añade contexto para tu yo del futuro…" rows={3} /></label>
          {(values.kind === 'idea' || values.kind === 'task') && <label className="capture-select">Proyecto relacionado <span>opcional</span><select value={values.projectId} onChange={(event) => set('projectId', event.target.value)}><option value="">Sin proyecto</option>{projects.filter((project) => !project.archivedAt).map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>}
          {values.kind !== 'goal' && <label className="capture-select">Objetivo relacionado <span>opcional</span><select value={values.goalId} onChange={(event) => set('goalId', event.target.value)}><option value="">Sin objetivo</option>{goals.filter((goal) => !goal.archivedAt).map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>}
          <div className="capture-footer"><span><kbd>Enter</kbd> para guardar</span><Button type="submit" icon={<Flag size={15} />}>Guardar captura</Button></div>
        </form>
      )}
    </Modal>
  )
}
