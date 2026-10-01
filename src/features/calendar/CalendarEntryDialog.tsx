import { addMinutes } from 'date-fns'
import { useRef, useState, type FormEvent } from 'react'
import { Button, Modal } from '../../components/common'
import { useAuth } from '../../hooks/auth'
import { useWorkspaces } from '../../hooks/useWorkspaces'
import { timestampToLocalParts, localDateTimeToTimestamp } from '../../lib/calendarDates'
import { calendarEntryRepository } from '../../repositories/calendarEntryRepository'
import type { Task } from '../../types'
import { TaskFormDialog } from '../planning/PlanningDialogs'

type CreationKind = 'event' | 'task'

interface Props {
  open: boolean
  startsAt: string
  estimatedMinutes?: number
  workspaceId?: string
  onClose: (saved?: boolean, feedback?: string) => void
}

export function CalendarEntryDialog({ open, startsAt, estimatedMinutes = 30, workspaceId, onClose }: Props) {
  const { user } = useAuth()
  const { data: workspaces } = useWorkspaces()
  const [kind, setKind] = useState<CreationKind>('task')
  const [taskMode, setTaskMode] = useState(false)
  const [concentration, setConcentration] = useState(false)
  const parts = timestampToLocalParts(startsAt)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(parts.date)
  const [time, setTime] = useState(parts.time)
  const [minutes, setMinutes] = useState(String(estimatedMinutes))
  const fallbackWorkspace = workspaces.find((item) => item.name === 'Personal')?.id ?? workspaces[0]?.id ?? ''
  const [selectedWorkspace, setSelectedWorkspace] = useState(workspaceId ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const createFocusBlock = async (task: Task) => {
    if (!concentration || !user) return
    await calendarEntryRepository.create({ title: task.title, kind: 'focus', startsAt, endsAt: addMinutes(new Date(startsAt), estimatedMinutes).toISOString(), allDay: false, workspaceId: task.workspaceId, linkedTaskId: task.id }, user.id)
    window.dispatchEvent(new Event('faro:calendar-updated'))
  }

  if (taskMode) return <TaskFormDialog open dueAt={startsAt} estimatedMinutes={estimatedMinutes} workspaceId={workspaceId} onSaved={createFocusBlock} onSavedError={(reason) => onClose(true, reason instanceof Error ? `La tarea se creó, pero no pudimos crear el bloque de concentración: ${reason.message}` : 'La tarea se creó, pero no pudimos crear el bloque de concentración.')} onClose={() => onClose(true, 'Tarea creada')} />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (savingRef.current) return
    if (kind === 'task') { setTaskMode(true); return }
    if (!user || !title.trim()) { setError('Escribe un título.'); return }
    const start = localDateTimeToTimestamp(date, time || '09:00')
    if (!start) { setError('Selecciona una fecha y hora válidas.'); return }
    savingRef.current = true; setSaving(true); setError('')
    try {
      await calendarEntryRepository.create({
        title, description: description || undefined, kind: 'event',
        startsAt: start, endsAt: addMinutes(new Date(start), Math.max(15, Number(minutes) || 30)).toISOString(),
        allDay: false, workspaceId: selectedWorkspace || fallbackWorkspace || undefined,
      }, user.id)
      onClose(true, 'Evento creado')
    } catch (reason) {
      savingRef.current = false
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar en Supabase.')
    } finally { setSaving(false) }
  }

  return <Modal open={open} title="Agregar al calendario" onClose={() => onClose()} panelClassName="calendar-entry-modal">
    <form className="planning-form calendar-entry-form" onSubmit={submit}>
      <fieldset className="calendar-kind-picker"><legend>¿Qué vas a reservar?</legend>
        <button type="button" className={kind === 'event' ? 'active' : ''} onClick={() => setKind('event')}><strong>Evento</strong><span>Algo a lo que asistirás</span></button>
        <button type="button" className={kind === 'task' ? 'active' : ''} onClick={() => setKind('task')}><strong>Tarea</strong><span>Un resultado por completar</span></button>
      </fieldset>
      {kind === 'task' ? <><p className="calendar-kind-help">Continuarás al formulario de tarea. También aparecerá en Backlog y en Hoy.</p><label className="calendar-concentration-toggle"><input type="checkbox" checked={concentration} onChange={(event) => setConcentration(event.target.checked)} /><span><strong>Modo concentración</strong><small>Antes de iniciar el bloque FARO te preguntará si estás listo y activará la concentración al confirmarlo.</small></span></label></> : <>
        <label>Título<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ej. Junta con stakeholder" /></label>
        <label>Descripción <span>opcional</span><textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <label>Workspace<select value={selectedWorkspace || fallbackWorkspace} onChange={(event) => setSelectedWorkspace(event.target.value)}>{workspaces.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div className="planning-form__grid"><label>Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Hora<input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label><label>Duración (min)<input type="number" min="15" step="15" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label></div>
      </>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button type="button" variant="ghost" onClick={() => onClose()}>Cancelar</Button><Button type="submit" disabled={saving}>{kind === 'task' ? 'Continuar con tarea' : 'Crear evento'}</Button></div>
    </form>
  </Modal>
}
