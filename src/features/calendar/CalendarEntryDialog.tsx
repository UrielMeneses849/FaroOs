import { addMinutes } from 'date-fns'
import { useMemo, useState, type FormEvent } from 'react'
import { Button, Modal } from '../../components/common'
import { useAuth } from '../../hooks/auth'
import { useWorkspaces } from '../../hooks/useWorkspaces'
import { timestampToLocalParts, localDateTimeToTimestamp } from '../../lib/calendarDates'
import { calendarEntryRepository } from '../../repositories/calendarEntryRepository'
import { useFaroStore } from '../../store'
import type { CalendarEntryKind } from '../../types'
import { TaskFormDialog } from '../planning/PlanningDialogs'

type CreationKind = CalendarEntryKind | 'task'

interface Props {
  open: boolean
  startsAt: string
  estimatedMinutes?: number
  workspaceId?: string
  onClose: (saved?: boolean) => void
}

export function CalendarEntryDialog({ open, startsAt, estimatedMinutes = 30, workspaceId, onClose }: Props) {
  const { user } = useAuth()
  const { data: workspaces } = useWorkspaces()
  const tasks = useFaroStore((state) => state.tasks)
  const [kind, setKind] = useState<CreationKind>('event')
  const [taskMode, setTaskMode] = useState(false)
  const parts = timestampToLocalParts(startsAt)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(parts.date)
  const [time, setTime] = useState(parts.time)
  const [minutes, setMinutes] = useState(String(estimatedMinutes))
  const fallbackWorkspace = workspaces.find((item) => item.name === 'Personal')?.id ?? workspaces[0]?.id ?? ''
  const [selectedWorkspace, setSelectedWorkspace] = useState(workspaceId ?? '')
  const [linkedTaskId, setLinkedTaskId] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const availableTasks = useMemo(() => tasks.filter((task) => task.status !== 'done' && !task.archivedAt), [tasks])

  if (taskMode) return <TaskFormDialog open dueAt={startsAt} estimatedMinutes={estimatedMinutes} workspaceId={workspaceId} onClose={() => onClose(true)} />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (kind === 'task') { setTaskMode(true); return }
    if (!user || !title.trim()) { setError('Escribe un título.'); return }
    const start = localDateTimeToTimestamp(date, time || '09:00')
    if (!start) { setError('Selecciona una fecha y hora válidas.'); return }
    setSaving(true); setError('')
    try {
      await calendarEntryRepository.create({
        title, description: description || undefined, kind,
        startsAt: start, endsAt: addMinutes(new Date(start), Math.max(15, Number(minutes) || 30)).toISOString(),
        allDay: false, workspaceId: selectedWorkspace || fallbackWorkspace || undefined,
        linkedTaskId: kind === 'focus' && linkedTaskId ? linkedTaskId : undefined,
      }, user.id)
      onClose(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar en Supabase.')
    } finally { setSaving(false) }
  }

  return <Modal open={open} title="Agregar al calendario" onClose={() => onClose()} panelClassName="calendar-entry-modal">
    <form className="planning-form calendar-entry-form" onSubmit={submit}>
      <fieldset className="calendar-kind-picker"><legend>¿Qué vas a reservar?</legend>
        <button type="button" className={kind === 'event' ? 'active' : ''} onClick={() => setKind('event')}><strong>Evento</strong><span>Algo a lo que asistirás</span></button>
        <button type="button" className={kind === 'task' ? 'active' : ''} onClick={() => setKind('task')}><strong>Tarea</strong><span>Un resultado por completar</span></button>
        <button type="button" className={kind === 'focus' ? 'active' : ''} onClick={() => setKind('focus')}><strong>Enfoque</strong><span>Tiempo reservado para avanzar</span></button>
      </fieldset>
      {kind === 'task' ? <p className="calendar-kind-help">Continuarás al formulario de tarea. Esta opción sí aparecerá en Backlog y tendrá checkbox en Hoy.</p> : <>
        <label>Título<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder={kind === 'event' ? 'Ej. Junta con stakeholder' : 'Ej. Avanzar ajustes BIMSA'} /></label>
        <label>Descripción <span>opcional</span><textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <label>Workspace<select value={selectedWorkspace || fallbackWorkspace} onChange={(event) => setSelectedWorkspace(event.target.value)}>{workspaces.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div className="planning-form__grid"><label>Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Hora<input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label><label>Duración (min)<input type="number" min="15" step="15" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label></div>
        {kind === 'focus' && <label>Tarea relacionada <span>opcional</span><select value={linkedTaskId} onChange={(event) => setLinkedTaskId(event.target.value)}><option value="">Sin tarea relacionada</option>{availableTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>}
      </>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button type="button" variant="ghost" onClick={() => onClose()}>Cancelar</Button><Button type="submit" disabled={saving}>{kind === 'task' ? 'Continuar' : `Crear ${kind === 'event' ? 'evento' : 'bloque'}`}</Button></div>
    </form>
  </Modal>
}
