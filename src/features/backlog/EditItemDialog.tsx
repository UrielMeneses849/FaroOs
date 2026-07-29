import { useState, type FormEvent } from 'react'
import { Button, Modal } from '../../components/common'
import { useFaroStore } from '../../store'
import type { LifeArea, Priority } from '../../types'
import type { BacklogItem } from './backlogTypes'
import { RelationshipPicker } from './RelationshipPicker'

const statusOptions = {
  idea: [['inbox', 'Inbox'], ['archived', 'Archivado']],
  task: [['inbox', 'Inbox'], ['todo', 'Por hacer'], ['doing', 'En curso'], ['done', 'Listo']],
  project: [['idea', 'Idea'], ['planned', 'Planeado'], ['active', 'Activo'], ['paused', 'En pausa'], ['completed', 'Completado']],
  goal: [['active', 'Activo'], ['paused', 'En pausa'], ['completed', 'Completado']],
}
const areaOptions: Array<[LifeArea, string]> = [['personal', 'Personal'], ['health', 'Salud'], ['finance', 'Finanzas'], ['learning', 'Aprendizaje'], ['nexvora', 'Nexvora'], ['portfolio', 'Portafolio'], ['travel', 'Viajes'], ['relationships', 'Relaciones']]

export function EditItemDialog({ item, onClose }: { item: BacklogItem | null; onClose: () => void }) {
  const [draft, setDraft] = useState<BacklogItem | null>(item)
  const [error, setError] = useState('')
  const updateIdea = useFaroStore((state) => state.updateIdea)
  const updateTask = useFaroStore((state) => state.updateTask)
  const updateProject = useFaroStore((state) => state.updateProject)
  const updateGoal = useFaroStore((state) => state.updateGoal)
  if (!draft) return <Modal open={false} title="Editar" onClose={onClose}><span /></Modal>
  const set = (changes: Partial<BacklogItem>) => setDraft((current) => current ? { ...current, ...changes } : current)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!draft.title.trim()) { setError('El título es obligatorio'); return }
    if (draft.kind === 'idea') updateIdea(draft.id, { title: draft.title.trim(), description: draft.description, area: draft.area, status: draft.status as 'inbox' | 'archived' | 'converted', date: draft.date, projectId: draft.projectId, goalId: draft.goalId })
    if (draft.kind === 'task') updateTask(draft.id, { title: draft.title.trim(), notes: draft.description, area: draft.area, status: draft.status as 'inbox' | 'todo' | 'doing' | 'done', priority: draft.priority, dueDate: draft.date, projectId: draft.projectId, goalId: draft.goalId })
    if (draft.kind === 'project') updateProject(draft.id, { title: draft.title.trim(), description: draft.description, area: draft.area, status: draft.status as 'idea' | 'planned' | 'active' | 'paused' | 'completed', goalId: draft.goalId })
    if (draft.kind === 'goal') updateGoal(draft.id, { title: draft.title.trim(), description: draft.description, area: draft.area, status: draft.status as 'active' | 'paused' | 'completed', targetDate: draft.date })
    onClose()
  }
  return <Modal open={Boolean(item)} title={`Editar ${draft.kind === 'idea' ? 'idea' : draft.kind === 'task' ? 'tarea' : draft.kind === 'project' ? 'proyecto' : 'objetivo'}`} onClose={onClose}>
    <form className="edit-form" onSubmit={submit}>
      <label>Título<input autoFocus value={draft.title} onChange={(event) => set({ title: event.target.value })} aria-invalid={Boolean(error)} />{error && <span className="field-error">{error}</span>}</label>
      <label>Descripción <span>opcional</span><textarea rows={3} value={draft.description ?? ''} onChange={(event) => set({ description: event.target.value })} /></label>
      <div className="edit-form__grid"><label>Área<select value={draft.area} onChange={(event) => set({ area: event.target.value as LifeArea })}>{areaOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Estado<select value={draft.status} onChange={(event) => set({ status: event.target.value })}>{statusOptions[draft.kind].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      {draft.kind === 'task' && <label>Prioridad<select value={draft.priority} onChange={(event) => set({ priority: event.target.value as Priority })}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option></select></label>}
      {(draft.kind === 'idea' || draft.kind === 'task' || draft.kind === 'goal') && <label>Fecha<input type="date" value={draft.date ?? ''} onChange={(event) => set({ date: event.target.value })} /></label>}
      <RelationshipPicker kind={draft.kind} projectId={draft.projectId} goalId={draft.goalId} onProject={(projectId) => set({ projectId: projectId || undefined })} onGoal={(goalId) => set({ goalId: goalId || undefined })} />
      <div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar cambios</Button></div>
    </form>
  </Modal>
}
