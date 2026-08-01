import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import type { DateSelectArg, DayHeaderContentArg, EventClickArg, EventDropArg, EventInput } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import { differenceInMinutes, format } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarClock, FilterX, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, EmptyState, Modal } from '../components/common'
import { StatusSelector } from '../components/common/StatusSelector'
import { PageHeader } from '../components/layout'
import { TaskFormDialog } from '../features/planning/PlanningDialogs'
import { CalendarEntryDialog } from '../features/calendar/CalendarEntryDialog'
import type { CalendarItem, CalendarSourceType } from '../features/calendar/calendarTypes'
import { useAuth } from '../hooks/auth'
import { useCalendarData } from '../hooks/useCalendarData'
import { usePageCapture } from '../hooks/usePageCapture'
import { useWorkspaces } from '../hooks/useWorkspaces'
import {
  calendarEnd,
  calendarDateToTimestamp,
  localDateTimeToTimestamp,
  normalizeDateOnly,
  parseTimestamp,
  timestampToWallTime,
} from '../lib/calendarDates'
import { relativeDayLabel, rollingWeekRange } from '../lib/rollingCalendar'
import { taskRepository } from '../repositories/taskRepository'
import { calendarEntryRepository } from '../repositories/calendarEntryRepository'
import { useFaroStore } from '../store'
import type { Priority, Task, TaskStatus } from '../types'

export function CalendarPage() {
  const { user } = useAuth()
  const { capture } = usePageCapture()
  const navigate = useNavigate()
  const { data, loading, error, refresh } = useCalendarData()
  const { data: workspaces } = useWorkspaces()
  const tasks = useFaroStore((state) => state.tasks)
  const updateTask = useFaroStore((state) => state.updateTask)
  const deleteTask = useFaroStore((state) => state.deleteTask)
  const [localItems, setLocalItems] = useState<CalendarItem[] | null>(null)
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([])
  const [sourceType, setSourceType] = useState<CalendarSourceType | 'all'>('all')
  const [status, setStatus] = useState<string>('all')
  const [priority, setPriority] = useState<Priority | 'all'>('all')
  const [creatingAt, setCreatingAt] = useState<string>()
  const [creatingDuration, setCreatingDuration] = useState<number>()
  const [creatingWorkspace, setCreatingWorkspace] = useState<string>()
  const [selected, setSelected] = useState<CalendarItem | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  const [feedback, setFeedback] = useState('')
  const calendarRef = useRef<InstanceType<typeof FullCalendar> | null>(null)
  const activeWorkspaces = workspaces.filter((workspace) => workspace.isActive)
  const initialView = window.innerWidth < 700 ? 'listWeek' : window.innerWidth < 1020 ? 'timeGridDay' : 'rollingWeek'

  const items = localItems ?? data.items
  const setItems = (updater: (current: CalendarItem[]) => CalendarItem[]) =>
    setLocalItems((current) => updater(current ?? data.items))
  const filtered = useMemo(() => items.filter((item) =>
    (!workspaceIds.length || (item.workspaceId && workspaceIds.includes(item.workspaceId)))
    && (sourceType === 'all' || item.sourceType === sourceType)
    && (status === 'all' || item.status === status)
    && (priority === 'all' || item.priority === priority),
  ), [items, priority, sourceType, status, workspaceIds])
  const colors = new Map(activeWorkspaces.map((workspace) => [workspace.id, workspace.color ?? '#2457ff']))
  const events: EventInput[] = filtered.map((item) => ({
    id: item.id, title: item.title,
    start: item.allDay ? item.start : timestampToWallTime(item.start),
    end: item.allDay ? item.end : timestampToWallTime(item.end),
    allDay: item.allDay,
    editable: item.editable, durationEditable: (item.sourceType === 'task' || item.sourceType === 'event') && !item.allDay,
    backgroundColor: `${colors.get(item.workspaceId ?? '') ?? '#2457ff'}22`,
    borderColor: colors.get(item.workspaceId ?? '') ?? '#2457ff',
    textColor: '#eeeeF2', extendedProps: { item },
    classNames: [`calendar-event--${item.sourceType}`, `calendar-event--${item.status}`],
  }))
  const restoreItem = (previous: CalendarItem, previousTask: Task) => {
    setLocalItems((current) => (current ?? data.items).map((item) => item.id === previous.id ? previous : item))
    useFaroStore.setState((state) => ({ tasks: state.tasks.map((task) => task.id === previousTask.id ? previousTask : task) }))
  }
  const persistMove = async (item: CalendarItem, dueAt: string, minutes: number | undefined, revert: () => void) => {
    if (item.sourceType === 'event' && user) {
      const previous = item
      const end = calendarEnd(dueAt, minutes ?? 30)
      if (!end) { revert(); setFeedback('No se pudo calcular el final del evento.'); return }
      setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, start: dueAt, end } : candidate))
      try { await calendarEntryRepository.updateSchedule(item.sourceId, dueAt, end, user.id); setFeedback('Horario actualizado') }
      catch (reason) { revert(); setItems((current) => current.map((candidate) => candidate.id === previous.id ? previous : candidate)); setFeedback(reason instanceof Error ? reason.message : 'No se guardó el cambio.') }
      return
    }
    const previousTask = tasks.find((task) => task.id === item.sourceId)
    if (!previousTask || !user) return
    const previous = item
    const allDay = /^\d{4}-\d{2}-\d{2}$/.test(dueAt)
    const nextEnd = allDay || !minutes ? undefined : calendarEnd(dueAt, minutes)
    setLocalItems((current) => (current ?? data.items).map((candidate) => candidate.id === item.id ? { ...candidate, start: dueAt, end: nextEnd, allDay } : candidate))
    updateTask(previousTask.id, { dueAt: allDay ? undefined : dueAt, dueDate: dueAt.slice(0, 10), estimatedMinutes: minutes })
    try {
      await taskRepository.updateSchedule(previousTask.id, dueAt, minutes, user.id)
      setFeedback('Horario actualizado')
    } catch (reason) {
      revert()
      restoreItem(previous, previousTask)
      setFeedback(reason instanceof Error ? reason.message : 'No se guardó el cambio.')
    }
  }
  const drop = (info: EventDropArg) => {
    const item = info.event.extendedProps.item as CalendarItem
    if ((item.sourceType !== 'task' && item.sourceType !== 'event') || !info.event.start) return info.revert()
    const dueAt = info.event.allDay ? format(info.event.start, 'yyyy-MM-dd') : calendarDateToTimestamp(info.event.start)
    if (!dueAt) {
      setFeedback('La fecha seleccionada no es válida.')
      return info.revert()
    }
    const duration = info.event.end ? differenceInMinutes(info.event.end, info.event.start) : tasks.find((task) => task.id === item.sourceId)?.estimatedMinutes
    void persistMove(item, dueAt, duration, info.revert)
  }
  const resize = (info: EventResizeDoneArg) => {
    const item = info.event.extendedProps.item as CalendarItem
    if ((item.sourceType !== 'task' && item.sourceType !== 'event') || !info.event.start || !info.event.end) return info.revert()
    const minutes = Math.max(15, differenceInMinutes(info.event.end, info.event.start))
    const dueAt = calendarDateToTimestamp(info.event.start)
    if (!dueAt) {
      setFeedback('La fecha seleccionada no es válida.')
      return info.revert()
    }
    void persistMove(item, dueAt, minutes, info.revert)
  }
  const selectSlot = (selection: DateSelectArg) => {
    const date = format(selection.start, 'yyyy-MM-dd')
    const timestamp = selection.allDay
      ? localDateTimeToTimestamp(date, '09:00')
      : calendarDateToTimestamp(selection.start)
    if (!timestamp) {
      setFeedback('La fecha seleccionada no es válida.')
      return
    }
    setCreatingAt(timestamp)
    setCreatingDuration(selection.allDay ? 30 : Math.max(15, differenceInMinutes(selection.end, selection.start)))
    const selectedWorkspace = workspaceIds.length === 1 ? workspaceIds[0] : activeWorkspaces.find((workspace) => workspace.name === 'Personal')?.id ?? activeWorkspaces[0]?.id
    setCreatingWorkspace(selectedWorkspace)
  }
  const clickEvent = (info: EventClickArg) => {
    const item = info.event.extendedProps.item as CalendarItem
    if (item.sourceType === 'project') navigate(`/projects/${item.sourceId}`)
    else if (item.sourceType === 'goal') navigate(`/goals/${item.sourceId}`)
    else setSelected(item)
  }
  const selectedTask = selected?.sourceType === 'task' ? tasks.find((task) => task.id === selected.sourceId) : undefined
  const selectedTaskTimestamp = parseTimestamp(selectedTask?.dueAt)
  const selectedTaskDate = normalizeDateOnly(selectedTask?.dueDate)

  if (loading && !items.length) return <div className="page"><div className="calendar-skeleton" role="status">Sincronizando calendario…</div></div>
  if (error && !items.length) return <div className="page"><EmptyState title="No pudimos cargar el calendario" description={error} action={<Button onClick={refresh}>Reintentar</Button>} /></div>
  return <div className="page calendar-page"><PageHeader eyebrow={data.timezone} title="Calendario" description="Tiempo, contexto y ejecución en una sola vista." onCapture={capture} />
    <div className="calendar-filters"><div className="calendar-workspaces"><button className={!workspaceIds.length ? 'active' : ''} onClick={() => setWorkspaceIds([])}>Todos</button>{activeWorkspaces.map((workspace) => <button key={workspace.id} className={workspaceIds.includes(workspace.id) ? 'active' : ''} onClick={() => setWorkspaceIds((current) => current.includes(workspace.id) ? current.filter((id) => id !== workspace.id) : [...current, workspace.id])}><i style={{ background: workspace.color }} />{workspace.name}</button>)}</div><select aria-label="Tipo" value={sourceType} onChange={(event) => setSourceType(event.target.value as CalendarSourceType | 'all')}><option value="all">Todos los tipos</option><option value="task">Tareas</option><option value="project">Proyectos</option><option value="goal">Objetivos</option><option value="event">Eventos</option></select><select aria-label="Estado" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Cualquier estado</option><option value="todo">Por hacer</option><option value="doing">En progreso</option><option value="paused">Pausado</option><option value="blocked">Bloqueado</option><option value="done">Completado</option><option value="active">Activo</option></select><select aria-label="Prioridad" value={priority} onChange={(event) => setPriority(event.target.value as Priority | 'all')}><option value="all">Cualquier prioridad</option><option value="critical">Crítica</option><option value="high">Alta</option><option value="medium">Media</option><option value="low">Baja</option></select><button aria-label="Limpiar filtros" onClick={() => { setWorkspaceIds([]); setSourceType('all'); setStatus('all'); setPriority('all') }}><FilterX size={15} /></button></div>
    {feedback && <div className="calendar-feedback" role="status">{feedback}<button onClick={() => setFeedback('')}>×</button></div>}
    <div className="calendar-layout"><section className="calendar-surface"><FullCalendar ref={calendarRef} plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]} views={{ rollingWeek: { type: 'timeGrid', duration: { days: 7 }, dateIncrement: { days: 7 }, dateAlignment: 'day', visibleRange: rollingWeekRange } }} initialView={initialView} initialDate={new Date()} locale="es" timeZone="local" firstDay={1} height="100%" stickyHeaderDates expandRows={false} nowIndicator selectable selectMirror editable events={events} select={selectSlot} eventClick={clickEvent} eventDrop={drop} eventResize={resize} customButtons={{ faroToday: { text: 'Hoy', click: () => calendarRef.current?.getApi().gotoDate(new Date()) } }} headerToolbar={{ left: 'prev,next faroToday', center: 'title', right: 'rollingWeek,timeGridWeek,dayGridMonth,timeGridDay,listWeek' }} buttonText={{ rollingWeek: '7 días', month: 'Mes', week: 'Semana', day: 'Día', list: 'Agenda' }} titleFormat={{ day: 'numeric', month: 'long', year: 'numeric' }} dayHeaderContent={calendarDayHeader} dayMaxEvents={2} dayMaxEventRows={2} moreLinkClick="popover" slotMinTime="00:00:00" slotMaxTime="24:00:00" slotDuration="00:30:00" snapDuration="00:30:00" slotLabelInterval="01:00:00" scrollTime={`${String(Math.max(0, new Date().getHours() - 2)).padStart(2, '0')}:00:00`} scrollTimeReset={false} allDayText="Todo el día" eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }} /></section></div>
    {creatingAt && <CalendarEntryDialog open startsAt={creatingAt} estimatedMinutes={creatingDuration} workspaceId={creatingWorkspace} onClose={(saved) => { setCreatingAt(undefined); setCreatingDuration(undefined); setCreatingWorkspace(undefined); if (saved) { setLocalItems(null); queueMicrotask(() => void refresh()) } }} />}
    {editing && <TaskFormDialog open initial={editing} onClose={() => { setEditing(null); setSelected(null); setLocalItems(null); queueMicrotask(() => void refresh()) }} />}
    {selectedTask && <Modal open title="Detalle de tarea" onClose={() => setSelected(null)}><div className="calendar-detail"><span className="eyebrow">{activeWorkspaces.find((workspace) => workspace.id === selectedTask.workspaceId)?.name ?? 'Sin workspace'}</span><h2>{selectedTask.title}</h2>{selectedTask.description && <p>{selectedTask.description}</p>}<div><StatusSelector task={selectedTask} value={selectedTask.status} onChange={(nextStatus: TaskStatus) => { updateTask(selectedTask.id, { status: nextStatus }); setItems((current) => current.map((item) => item.sourceId === selectedTask.id ? { ...item, status: nextStatus } : item)) }} /><span className={`priority priority--${selectedTask.priority}`}>{selectedTask.priority}</span><span><CalendarClock size={13} />{selectedTaskTimestamp ? format(selectedTaskTimestamp, 'dd/MM/yyyy HH:mm') : selectedTaskDate ?? 'Sin fecha válida'}</span><span>{selectedTask.estimatedMinutes ?? 0} min</span></div>{selectedTask.notes && <small>{selectedTask.notes}</small>}<footer><Button variant="secondary" icon={<Pencil size={14} />} onClick={() => setEditing(selectedTask)}>Editar</Button>{selectedTask.projectId && <Button variant="secondary" onClick={() => navigate(`/projects/${selectedTask.projectId}`)}>Abrir proyecto</Button>}<Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => { deleteTask(selectedTask.id); setItems((current) => current.filter((item) => item.sourceId !== selectedTask.id)); setSelected(null) }}>Eliminar</Button></footer></div></Modal>}
    {selected?.sourceType === 'event' && <Modal open title={selected.entryKind === 'focus' ? 'Bloque de enfoque' : 'Evento'} onClose={() => setSelected(null)}><div className="calendar-detail"><span className="eyebrow">{activeWorkspaces.find((workspace) => workspace.id === selected.workspaceId)?.name ?? 'Sin workspace'}</span><h2>{selected.title}</h2>{selected.description && <p>{selected.description}</p>}<div><span><CalendarClock size={13} />{format(parseTimestamp(selected.start) ?? new Date(selected.start), 'dd/MM/yyyy HH:mm')}</span>{selected.linkedTaskId && <span>Tarea vinculada: {tasks.find((task) => task.id === selected.linkedTaskId)?.title ?? 'No disponible'}</span>}</div><footer>{selected.linkedTaskId && <Button variant="secondary" onClick={() => navigate('/today')}>Abrir en Hoy</Button>}<Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => { if (!user) return; void calendarEntryRepository.remove(selected.sourceId, user.id).then(() => { setItems((current) => current.filter((item) => item.id !== selected.id)); setSelected(null); setFeedback('Entrada eliminada') }).catch((reason) => setFeedback(reason instanceof Error ? reason.message : 'No se pudo eliminar.')) }}>Eliminar</Button></footer></div></Modal>}
  </div>
}

function calendarDayHeader(arg: DayHeaderContentArg) {
  const relative = relativeDayLabel(arg.date)
  return <div className="calendar-day-header">{relative && <small>{relative}</small>}<span>{format(arg.date, 'EEE', { locale: es })}</span><strong>{format(arg.date, 'd')}</strong></div>
}
