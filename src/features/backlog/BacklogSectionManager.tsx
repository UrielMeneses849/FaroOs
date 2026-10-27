import { useState, type FormEvent } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { Button, Modal } from '../../components/common'
import { useAuth } from '../../hooks/auth'
import { backlogSectionRepository } from '../../repositories/backlogSectionRepository'
import type { BacklogSection } from '../../types'

type Draft = Pick<BacklogSection, 'id' | 'name' | 'color' | 'sortOrder'>

export function BacklogSectionManager({ open, workspaceId, workspaceName, sections, onChanged, onClose }: {
  open: boolean
  workspaceId: string
  workspaceName: string
  sections: BacklogSection[]
  onChanged: () => Promise<void>
  onClose: () => void
}) {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [color, setColor] = useState('#5b8cff')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (!user || !name.trim()) return
    setBusyId('new'); setError('')
    try {
      await backlogSectionRepository.create({ workspaceId, name, color, sortOrder: sections.length * 1000 }, user.id)
      setName(''); await onChanged()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo crear la sección.') }
    finally { setBusyId(null) }
  }

  const save = async (draft: Draft) => {
    if (!user || !draft.name.trim()) return
    setBusyId(draft.id); setError('')
    try { await backlogSectionRepository.update(draft.id, draft, user.id); await onChanged() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo actualizar la sección.') }
    finally { setBusyId(null) }
  }

  const remove = async (draft: Draft) => {
    if (!user || !window.confirm(`¿Eliminar la sección “${draft.name}”? Las tareas quedarán sin sección.`)) return
    setBusyId(draft.id); setError('')
    try { await backlogSectionRepository.remove(draft.id, user.id); await onChanged() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo eliminar la sección.') }
    finally { setBusyId(null) }
  }

  return <Modal open={open} title={`Secciones · ${workspaceName}`} panelClassName="backlog-sections-modal" onClose={onClose}>
    <div className="backlog-section-manager">
      <p>Divide el producto por módulos o pantallas. Después podrás filtrar el kanban y medir el avance de cada sección.</p>
      <form className="backlog-section-manager__create" onSubmit={create}>
        <input type="color" aria-label="Color de la nueva sección" value={color} onChange={(event) => setColor(event.target.value)} />
        <input aria-label="Nombre de la nueva sección" placeholder="Ej. Explorer, Rutas, Dashboard…" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
        <Button type="submit" disabled={!name.trim() || busyId === 'new'}><Plus size={15} />Crear</Button>
      </form>
      {error && <div className="field-error" role="alert">{error}</div>}
      <div className="backlog-section-manager__list">
        {sections.map((section) => <BacklogSectionRow key={`${section.id}:${section.updatedAt}`} section={section} busy={busyId === section.id} onSave={save} onRemove={remove} />)}
        {!sections.length && <p className="backlog-section-manager__empty">Todavía no hay secciones. Crea la primera para empezar a clasificar el backlog.</p>}
      </div>
    </div>
  </Modal>
}

function BacklogSectionRow({ section, busy, onSave, onRemove }: {
  section: BacklogSection
  busy: boolean
  onSave: (draft: Draft) => Promise<void>
  onRemove: (draft: Draft) => Promise<void>
}) {
  const [name, setName] = useState(section.name)
  const [color, setColor] = useState(section.color)
  const draft = { id: section.id, name, color, sortOrder: section.sortOrder }
  return <div className="backlog-section-manager__row">
    <input type="color" aria-label={`Color de ${section.name}`} value={color} onChange={(event) => setColor(event.target.value)} />
    <input aria-label={`Nombre de ${section.name}`} maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
    <button type="button" aria-label={`Guardar ${section.name}`} disabled={busy || !name.trim()} onClick={() => void onSave(draft)}><Save size={15} /></button>
    <button type="button" className="danger" aria-label={`Eliminar ${section.name}`} disabled={busy} onClick={() => void onRemove(draft)}><Trash2 size={15} /></button>
  </div>
}
