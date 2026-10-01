import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import type { DateSelectArg, DayHeaderContentArg, EventClickArg, EventContentArg, EventDropArg, EventInput } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import { addMonths, differenceInMinutes, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarClock, ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, ConfirmDialog, EmptyState, Modal } from '../components/common'
import { StatusSelector } from '../components/common/StatusSelector'
import { PageHeader } from '../components/layout'
import { TaskFormDialog } from '../features/planning/PlanningDialogs'
import { CalendarEntryDialog } from '../features/calendar/CalendarEntryDialog'
import { startCalendarConcentration } from '../features/computer/computerController'
import type { CalendarItem, CalendarSourceType } from '../features/calendar/calendarTypes'
import { useAuth } from '../hooks/auth'
import { useCalendarData } from '../hooks/useCalendarData'
import { useWorkspaces } from '../hooks/useWorkspaces'
import {
  calendarEnd,
  calendarDateToTimestamp,
  localDateTimeToTimestamp,
  normalizeDateOnly,
  parseTimestamp,
  timestampToWallTime,
} from '../lib/calendarDates'
import { rollingWeekRange } from '../lib/rollingCalendar'
import { calendarItemsInRange, calendarWorkspaceCounts, resolveCalendarWorkspaceId, type CalendarRange } from '../lib/calendarWorkspaceCounts'
import { CALENDAR_ZOOM_DEFAULT_SLOT_HEIGHT, calendarSlotHeightFromWheel, calendarZoomPercent, clampCalendarSlotHeight } from '../lib/calendarZoom'
import { taskRepository } from '../repositories/taskRepository'
import { calendarEntryRepository } from '../repositories/calendarEntryRepository'
import { useFaroStore } from '../store'
import type { Priority, Task, TaskStatus } from '../types'

const googleCalendarLogoUrl = 'https://www.gstatic.com/calendar/images/dynamiclogo_2020q4/calendar_31_2x.png'
const calendarWorkspaceOrder = ['BIMSA', 'BBVA', 'FARO OS', 'Nexvora', 'Portfolio', 'Portafolio', 'Personal']
const calendarWorkspaceColors: Record<string, string> = {
  BIMSA: '#ff9100',
  BBVA: '#38aaf2',
  'FARO OS': '#2868ff',
  Nexvora: '#8b5cf6',
  Portfolio: '#8b93a1',
  Portafolio: '#8b93a1',
  Personal: '#57a34b',
}
const calendarZoomStorageKey = 'faro:calendar-slot-height'

function storedCalendarSlotHeight() {
  try {
    const value = Number(localStorage.getItem(calendarZoomStorageKey))
    return value ? clampCalendarSlotHeight(value) : null
  } catch { return null }
}

function calendarWorkspaceLabel(name: string) {
  return name === 'Portfolio' ? 'Portafolio' : name
}

function calendarMonthLabel(date: Date) {
  const month = format(date, 'MMMM', { locale: es })
  return `${month.charAt(0).toLocaleUpperCase()}${month.slice(1)}`
}

function calendarTitleFormat(arg: { start: { marker: Date }; end?: { marker: Date } }) {
  const start = arg.start.marker
  const end = arg.end?.marker ?? start
  const sameDay = isSameDay(start, end)
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()
  if (sameDay) return `${format(start, 'd')} de ${calendarMonthLabel(start)} de ${format(start, 'yyyy')}`
  if (sameMonth) return `${format(start, 'd')} – ${format(end, 'd')} de ${calendarMonthLabel(end)} de ${format(end, 'yyyy')}`
  if (start.getFullYear() === end.getFullYear()) return `${format(start, 'd')} de ${calendarMonthLabel(start)} – ${format(end, 'd')} de ${calendarMonthLabel(end)} de ${format(end, 'yyyy')}`
  return `${format(start, 'd')} de ${calendarMonthLabel(start)} de ${format(start, 'yyyy')} – ${format(end, 'd')} de ${calendarMonthLabel(end)} de ${format(end, 'yyyy')}`
}

export function CalendarPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { data, loading, error, forceRefresh, google } = useCalendarData()
  const { data: workspaces } = useWorkspaces()
  const tasks = useFaroStore((state) => state.tasks)
  const updateTask = useFaroStore((state) => state.updateTask)
  const deleteTask = useFaroStore((state) => state.deleteTask)
  const [localItems, setLocalItems] = useState<CalendarItem[] | null>(null)
  useEffect(() => {
    const resetLocalSnapshot = () => setLocalItems(null)
    window.addEventListener('faro:calendar-updated', resetLocalSnapshot)
    return () => window.removeEventListener('faro:calendar-updated', resetLocalSnapshot)
  }, [])
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([])
  const [sourceType] = useState<CalendarSourceType | 'all'>('all')
  const [status] = useState<string>('all')
  const [priority] = useState<Priority | 'all'>('all')
  const [creatingAt, setCreatingAt] = useState<string>()
  const [creatingDuration, setCreatingDuration] = useState<number>()
  const [creatingWorkspace, setCreatingWorkspace] = useState<string>()
  const [selected, setSelected] = useState<CalendarItem | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  const [finishedTask, setFinishedTask] = useState<Task | null>(null)
  const [readyFocus, setReadyFocus] = useState<CalendarItem | null>(null)
  const promptedTaskIds = useRef(new Set<string>())
  const promptedFocusIds = useRef(new Set<string>())
  const [feedback, setFeedback] = useState(() => new URLSearchParams(window.location.search).get('googleCalendar') === 'error' ? 'No se completó la conexión con Google Calendar. Puedes intentarlo nuevamente.' : '')
  const [googleCalendarIds, setGoogleCalendarIds] = useState<string[]>([])
  const [editingGoogleCalendars, setEditingGoogleCalendars] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [miniMonth, setMiniMonth] = useState(() => new Date())
  const [focusedDate, setFocusedDate] = useState(() => new Date())
  const [visibleRange, setVisibleRange] = useState<CalendarRange>(() => {
    const start = new Date()
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    return { start: start.toISOString(), end: end.toISOString() }
  })
  const calendarRef = useRef<InstanceType<typeof FullCalendar> | null>(null)
  const calendarSurfaceRef = useRef<HTMLElement | null>(null)
  const zoomIndicatorTimer = useRef<number | undefined>(undefined)
  const initialSlotHeight = storedCalendarSlotHeight() ?? CALENDAR_ZOOM_DEFAULT_SLOT_HEIGHT
  const slotHeightRef = useRef(initialSlotHeight)
  const gestureRef = useRef<{ height: number; anchorY: number; contentY: number; scroller: HTMLElement } | null>(null)
  const [slotHeight, setSlotHeight] = useState(initialSlotHeight)
  const [zoomIndicator, setZoomIndicator] = useState(false)
  const activeWorkspaces = useMemo(() => workspaces.filter((workspace) => workspace.isActive), [workspaces])
  const calendarWorkspaces = [...activeWorkspaces].sort((left, right) => {
    const leftOrder = calendarWorkspaceOrder.indexOf(left.name)
    const rightOrder = calendarWorkspaceOrder.indexOf(right.name)
    return (leftOrder < 0 ? Number.MAX_SAFE_INTEGER : leftOrder) - (rightOrder < 0 ? Number.MAX_SAFE_INTEGER : rightOrder)
  })
  const initialView = window.innerWidth < 700 ? 'listWeek' : window.innerWidth < 1020 ? 'timeGridDay' : 'rollingWeek'

  useEffect(() => { slotHeightRef.current = slotHeight }, [slotHeight])

  useEffect(() => {
    const surface = calendarSurfaceRef.current
    if (!surface) return
    const timeGridScroller = () => [...surface.querySelectorAll<HTMLElement>('.fc-scroller')]
      .find((element) => element.closest('.fc-timegrid') && element.scrollHeight > element.clientHeight)
      ?? surface.querySelector<HTMLElement>('.fc-timegrid .fc-scroller')
    const showZoom = () => {
      setZoomIndicator(true)
      window.clearTimeout(zoomIndicatorTimer.current)
      zoomIndicatorTimer.current = window.setTimeout(() => setZoomIndicator(false), 1300)
    }
    const updateZoom = (nextHeight: number, scroller: HTMLElement, anchorY: number, contentY: number, sourceHeight?: number) => {
      const next = clampCalendarSlotHeight(nextHeight)
      const current = slotHeightRef.current
      if (next === current) return
      slotHeightRef.current = next
      setSlotHeight(next)
      try { localStorage.setItem(calendarZoomStorageKey, String(next)) } catch { /* preference is optional */ }
      showZoom()
      requestAnimationFrame(() => {
        scroller.scrollTop = Math.max(0, contentY * (next / (sourceHeight ?? current)) - anchorY)
      })
    }
    const onWheel = (event: WheelEvent) => {
      if ((!event.metaKey && !event.ctrlKey) || !surface.querySelector('.fc-timegrid')) return
      if (gestureRef.current) { event.preventDefault(); return }
      const scroller = timeGridScroller()
      const current = slotHeightRef.current
      if (!scroller) return
      event.preventDefault()
      const anchorY = event.clientY - scroller.getBoundingClientRect().top
      updateZoom(calendarSlotHeightFromWheel(current, event.deltaY, event.deltaMode), scroller, anchorY, scroller.scrollTop + anchorY)
    }
    const onGestureStart = (event: Event) => {
      if (!surface.querySelector('.fc-timegrid')) return
      const gesture = event as Event & { clientY?: number }
      const scroller = timeGridScroller()
      const current = slotHeightRef.current
      if (!scroller) return
      event.preventDefault()
      const anchorY = (gesture.clientY ?? scroller.getBoundingClientRect().top + scroller.clientHeight / 2) - scroller.getBoundingClientRect().top
      gestureRef.current = { height: current, anchorY, contentY: scroller.scrollTop + anchorY, scroller }
    }
    const onGestureChange = (event: Event) => {
      const gesture = event as Event & { scale?: number }
      const start = gestureRef.current
      if (!start || !gesture.scale) return
      event.preventDefault()
      updateZoom(start.height * gesture.scale, start.scroller, start.anchorY, start.contentY, start.height)
    }
    const onGestureEnd = () => { gestureRef.current = null }
    surface.addEventListener('wheel', onWheel, { passive: false })
    surface.addEventListener('gesturestart', onGestureStart, { passive: false })
    surface.addEventListener('gesturechange', onGestureChange, { passive: false })
    surface.addEventListener('gestureend', onGestureEnd)
    return () => {
      window.clearTimeout(zoomIndicatorTimer.current)
      surface.removeEventListener('wheel', onWheel)
      surface.removeEventListener('gesturestart', onGestureStart)
      surface.removeEventListener('gesturechange', onGestureChange)
      surface.removeEventListener('gestureend', onGestureEnd)
    }
  }, [])

  const items = localItems ?? data.items
  const calendarItems = useMemo(() => calendarItemsInRange(items, visibleRange), [items, visibleRange])
  const workspaceCounts = useMemo(() => calendarWorkspaceCounts(calendarItems, activeWorkspaces), [activeWorkspaces, calendarItems])
  const setItems = (updater: (current: CalendarItem[]) => CalendarItem[]) =>
    setLocalItems((current) => updater(current ?? data.items))
  const filtered = useMemo(() => calendarItems.filter((item) =>
    (!workspaceIds.length || Boolean(resolveCalendarWorkspaceId(item, activeWorkspaces) && workspaceIds.includes(resolveCalendarWorkspaceId(item, activeWorkspaces)!)))
    && (sourceType === 'all' || item.sourceType === sourceType)
    && (status === 'all' || item.status === status)
    && (priority === 'all' || item.priority === priority),
  ), [activeWorkspaces, calendarItems, priority, sourceType, status, workspaceIds])
  const events: EventInput[] = filtered.map((item) => {
    const workspace = activeWorkspaces.find((candidate) => candidate.id === resolveCalendarWorkspaceId(item, activeWorkspaces))
    const workspaceName = workspace
      ? calendarWorkspaceLabel(workspace.name)
      : item.source === 'google' ? (item.calendarName ?? 'Google') : 'Sin workspace'
    const eventColor = workspace ? (calendarWorkspaceColors[workspace.name] ?? workspace.color ?? '#2868ff') : '#4285f4'
    return {
      id: item.id, title: item.title,
      start: item.allDay ? item.start : timestampToWallTime(item.start),
      end: item.allDay ? item.end : timestampToWallTime(item.end),
      allDay: item.allDay,
      editable: item.editable && !item.readOnly, durationEditable: item.editable && !item.readOnly && (item.sourceType === 'task' || item.sourceType === 'event') && !item.allDay,
      backgroundColor: `${eventColor}38`, borderColor: eventColor,
      textColor: '#f4f6f9', extendedProps: { item, workspaceName },
      classNames: [`calendar-event--${item.sourceType}`, `calendar-event--${item.status}`, ...(item.source === 'google' ? ['calendar-event--google'] : []), ...(item.sourceType === 'task' && item.allDay ? ['calendar-event--unscheduled'] : [])],
    }
  })
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
    if (item.readOnly || (item.sourceType !== 'task' && item.sourceType !== 'event') || !info.event.start) return info.revert()
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
    if (item.readOnly || (item.sourceType !== 'task' && item.sourceType !== 'event') || !info.event.start || !info.event.end) return info.revert()
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
  useEffect(() => {
    const checkFinishedTask = () => {
      if (finishedTask) return
      const now = Date.now()
      const candidate = tasks.find((task) => {
        if (task.status === 'done' || promptedTaskIds.current.has(task.id) || !task.dueAt || !task.estimatedMinutes) return false
        const endsAt = new Date(task.dueAt).getTime() + task.estimatedMinutes * 60_000
        return Number.isFinite(endsAt) && now >= endsAt && now - endsAt < 2 * 60_000
      })
      if (candidate) { promptedTaskIds.current.add(candidate.id); setFinishedTask(candidate) }
    }
    checkFinishedTask()
    const timer = window.setInterval(checkFinishedTask, 30_000)
    return () => window.clearInterval(timer)
  }, [finishedTask, tasks])
  useEffect(() => {
    const checkFocusStart = () => {
      if (readyFocus) return
      const now = Date.now()
      const focus = data.items.find((item) => item.entryKind === 'focus' && item.linkedTaskId && !promptedFocusIds.current.has(item.id) && (() => { const start = new Date(item.start).getTime(); return Number.isFinite(start) && start >= now && start - now <= 5 * 60_000 })())
      if (focus) { promptedFocusIds.current.add(focus.id); setReadyFocus(focus) }
    }
    checkFocusStart()
    const timer = window.setInterval(checkFocusStart, 30_000)
    return () => window.clearInterval(timer)
  }, [data.items, readyFocus])
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
  if (error && !items.length) return <div className="page"><EmptyState title="No pudimos cargar el calendario" description={error} action={<Button onClick={() => void forceRefresh()}>Reintentar</Button>} /></div>
  return <div className="page calendar-page"><PageHeader eyebrow={format(new Date(), "EEEE, d 'de' MMMM", { locale: es })} title="Calendario" description="Tiempo, contexto y ejecución en una sola vista." />
    {feedback && <div className="calendar-feedback" role="status">{feedback}<button onClick={() => setFeedback('')}>×</button></div>}
    <div className="calendar-layout">
      <aside className="calendar-sidebar">
        <section className="calendar-google" data-status={google.connection.status}>
          <div className="calendar-google__identity">
            <img src={googleCalendarLogoUrl} alt="Google Calendar" />
            <div>
              <strong>Google Calendar</strong>
              {!google.connection.connected && <span>Conecta un calendario externo en modo lectura.</span>}
              {google.connection.status === 'reconnect_required' && <span>La autorización venció o fue revocada. Reconecta para recuperar los eventos.</span>}
              {google.connection.connected && !google.connection.calendars?.length && !google.connection.calendarId && <span>Selecciona uno o varios calendarios que quieres consultar.</span>}
              {(google.connection.calendars?.length || google.connection.calendarId) && <span>{google.connection.calendars?.map((calendar) => calendar.name).join(' · ') || google.connection.calendarName || google.connection.calendarId}</span>}
              {google.connection.lastSyncedAt && <small>Actualizado {format(new Date(google.connection.lastSyncedAt), 'dd/MM HH:mm')}</small>}
              {google.error && <small className="calendar-google__error" role="alert">{google.error}</small>}
            </div>
          </div>
          {!google.connection.connected || google.connection.status === 'reconnect_required'
            ? <Button size="sm" disabled={google.loading} onClick={() => void google.connect()}>{google.loading ? 'Conectando…' : google.connection.status === 'reconnect_required' ? 'Reconectar Google Calendar' : 'Conectar Google Calendar'}</Button>
            : (!google.connection.calendars?.length && !google.connection.calendarId) || editingGoogleCalendars
              ? <div className="calendar-google__select"><select aria-label="Calendarios de Google" multiple value={googleCalendarIds} onChange={(event) => setGoogleCalendarIds([...event.currentTarget.selectedOptions].map((option) => option.value))}>{google.calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}{calendar.primary ? ' · Personal' : ''}</option>)}</select><span>Selecciona todos los calendarios que FARO debe mostrar.</span><div className="calendar-google__actions"><Button size="sm" variant="ghost" onClick={() => setEditingGoogleCalendars(false)}>Cancelar</Button><Button size="sm" disabled={!googleCalendarIds.length || google.loading} onClick={() => void google.selectMany(googleCalendarIds).then(() => setEditingGoogleCalendars(false))}>Usar {googleCalendarIds.length || ''} calendarios</Button></div></div>
              : <div className="calendar-google__status-row"><span className="calendar-google__status"><i />Sincronizado</span><div className="calendar-google__actions"><Button size="sm" variant="secondary" disabled={google.loading} onClick={() => { setGoogleCalendarIds(google.connection.calendars?.map((calendar) => calendar.id) ?? [google.connection.calendarId!]); setEditingGoogleCalendars(true); void google.list() }}>Calendarios</Button><Button size="sm" variant="secondary" disabled={google.loading} onClick={() => void google.sync()}>{google.loading ? 'Sincronizando…' : 'Sincronizar'}</Button><Button size="sm" variant="ghost" disabled={google.loading} onClick={() => setConfirmDisconnect(true)}>Desconectar</Button></div></div>}
        </section>
        <MiniMonthCalendar month={miniMonth} selected={focusedDate} onMonthChange={setMiniMonth} onSelect={(date) => { setFocusedDate(date); setMiniMonth(date); calendarRef.current?.getApi().gotoDate(date) }} />
        <section className="calendar-workspace-filter">
          <span>Filtrar por workspace</span>
          <button className={!workspaceIds.length ? 'active' : ''} onClick={() => setWorkspaceIds([])}><i />Todos <b>{workspaceCounts.all}</b></button>
          {calendarWorkspaces.map((workspace) => <button key={workspace.id} className={workspaceIds.includes(workspace.id) ? 'active' : ''} onClick={() => setWorkspaceIds((current) => current.includes(workspace.id) ? current.filter((id) => id !== workspace.id) : [...current, workspace.id])}><i style={{ background: calendarWorkspaceColors[workspace.name] ?? workspace.color }} />{calendarWorkspaceLabel(workspace.name)}<b>{workspaceCounts.byWorkspace[workspace.id] ?? 0}</b></button>)}
        </section>
      </aside>
      <section ref={calendarSurfaceRef} className="calendar-surface" style={{ '--calendar-slot-height': `${slotHeight}px` } as CSSProperties}>
        <div className={`calendar-zoom-indicator ${zoomIndicator ? 'is-visible' : ''}`} role="status" aria-live="polite">Zoom {calendarZoomPercent(slotHeight)}% <span>⌘ + scroll</span></div>
        <FullCalendar ref={calendarRef} plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]} views={{ rollingWeek: { type: 'timeGrid', duration: { days: 7 }, dateIncrement: { days: 7 }, dateAlignment: 'day', visibleRange: rollingWeekRange } }} initialView={initialView} initialDate={new Date()} locale="es" timeZone="local" firstDay={1} height="100%" stickyHeaderDates expandRows={false} nowIndicator selectable selectMirror editable events={events} select={selectSlot} eventClick={clickEvent} eventDrop={drop} eventResize={resize} eventContent={calendarEventContent} datesSet={(dateInfo) => { const nextDate = calendarRef.current?.getApi().getDate() ?? new Date(); setFocusedDate(nextDate); setMiniMonth(nextDate); setVisibleRange({ start: dateInfo.start.toISOString(), end: dateInfo.end.toISOString() }) }} customButtons={{ faroToday: { text: 'Hoy', click: () => calendarRef.current?.getApi().gotoDate(new Date()) } }} headerToolbar={{ left: 'prev,next faroToday', center: 'title', right: 'rollingWeek,timeGridWeek,timeGridDay,listWeek' }} buttonText={{ rollingWeek: '7 días', month: 'Mes', week: 'Semana', day: 'Día', list: 'Agenda' }} titleFormat={calendarTitleFormat} dayHeaderContent={calendarDayHeader} dayMaxEvents={2} dayMaxEventRows={2} moreLinkClick="popover" slotMinTime="00:00:00" slotMaxTime="24:00:00" slotDuration="00:30:00" snapDuration="00:30:00" slotLabelInterval="01:00:00" scrollTime="00:00:00" scrollTimeReset allDaySlot={false} eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }} />
      </section>
    </div>
    {creatingAt && <CalendarEntryDialog open startsAt={creatingAt} estimatedMinutes={creatingDuration} workspaceId={creatingWorkspace} onClose={(saved, message) => { setCreatingAt(undefined); setCreatingDuration(undefined); setCreatingWorkspace(undefined); if (message) setFeedback(message); if (saved) { setLocalItems(null); queueMicrotask(() => void forceRefresh()) } }} />}
    {editing && <TaskFormDialog open initial={editing} onClose={() => { setEditing(null); setSelected(null); setLocalItems(null); queueMicrotask(() => void forceRefresh()) }} />}
    {finishedTask && <Modal open title="¿Terminaste esta tarea?" onClose={() => setFinishedTask(null)}><div className="calendar-task-finish"><p>Terminó el bloque de <strong>{finishedTask.title}</strong>.</p><p>Si ya quedó, la marco como completada en Backlog. Si no, abrimos la tarea para moverla a otro horario.</p><div className="modal-actions"><Button variant="ghost" onClick={() => setFinishedTask(null)}>Después</Button><Button variant="secondary" onClick={() => { setEditing(finishedTask); setFinishedTask(null) }}>Reprogramar</Button><Button onClick={() => { updateTask(finishedTask.id, { status: 'done' }); setFinishedTask(null); setLocalItems(null) }}>Sí, completar</Button></div></div></Modal>}
    {readyFocus && <Modal open title="¿Listo para concentrarte?" onClose={() => setReadyFocus(null)}><div className="calendar-task-finish"><p>En breve comienza <strong>{readyFocus.title}</strong>.</p><p>Al iniciar, FARO activa el modo concentración durante la duración de este bloque.</p><div className="modal-actions"><Button variant="ghost" onClick={() => setReadyFocus(null)}>Ahora no</Button><Button onClick={() => { const task = tasks.find((item) => item.id === readyFocus.linkedTaskId); void startCalendarConcentration({ title: readyFocus.title, workspace: activeWorkspaces.find((workspace) => workspace.id === readyFocus.workspaceId)?.name ?? 'Concentración', taskId: task?.id, durationMinutes: Math.max(15, differenceInMinutes(new Date(readyFocus.end ?? readyFocus.start), new Date(readyFocus.start))) }); setReadyFocus(null) }}>Iniciar concentración</Button></div></div></Modal>}
    {selectedTask && <Modal open title="Detalle de tarea" onClose={() => setSelected(null)}><div className="calendar-detail"><span className="eyebrow">{activeWorkspaces.find((workspace) => workspace.id === selectedTask.workspaceId)?.name ?? 'Sin workspace'}</span><h2>{selectedTask.title}</h2>{selectedTask.description && <p>{selectedTask.description}</p>}<div><StatusSelector task={selectedTask} value={selectedTask.status} onChange={(nextStatus: TaskStatus) => { updateTask(selectedTask.id, { status: nextStatus }); setItems((current) => current.map((item) => item.sourceId === selectedTask.id ? { ...item, status: nextStatus } : item)) }} /><span className={`priority priority--${selectedTask.priority}`}>{selectedTask.priority}</span><span><CalendarClock size={13} />{selectedTaskTimestamp ? format(selectedTaskTimestamp, 'dd/MM/yyyy HH:mm') : selectedTaskDate ?? 'Sin fecha válida'}</span><span>{selectedTask.estimatedMinutes ?? 0} min</span></div>{!selectedTaskTimestamp && <p className="calendar-unscheduled-warning">Esta tarea tiene fecha, pero todavía no tiene una hora asignada.</p>}{selectedTask.notes && <small>{selectedTask.notes}</small>}<footer>{!selectedTaskTimestamp && <Button onClick={() => { setSelected(null); setEditing(selectedTask) }}>Programar</Button>}<Button variant="secondary" icon={<Pencil size={14} />} onClick={() => { setSelected(null); setEditing(selectedTask) }}>Editar</Button>{selectedTask.projectId && <Button variant="secondary" onClick={() => navigate(`/projects/${selectedTask.projectId}`)}>Abrir proyecto</Button>}<Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => { deleteTask(selectedTask.id); setItems((current) => current.filter((item) => item.sourceId !== selectedTask.id)); setSelected(null) }}>Eliminar</Button></footer></div></Modal>}
    {selected?.sourceType === 'event'&&selected.source==='google'&&<Modal open title="Evento de Google" onClose={()=>setSelected(null)}><div className="calendar-detail"><span className="eyebrow">Google · {selected.calendarName??'Calendario externo'}</span><h2>{selected.title}</h2><div><span><CalendarClock size={13}/>{selected.allDay?selected.start:format(parseTimestamp(selected.start)??new Date(selected.start),'dd/MM/yyyy HH:mm')}</span><span>Solo lectura</span></div></div></Modal>}
    {selected?.sourceType === 'event'&&selected.source!=='google'&&<Modal open title={selected.entryKind === 'focus' ? 'Bloque de enfoque' : 'Evento'} onClose={() => setSelected(null)}><div className="calendar-detail"><span className="eyebrow">{activeWorkspaces.find((workspace) => workspace.id === selected.workspaceId)?.name ?? 'Sin workspace'}</span><h2>{selected.title}</h2>{selected.description && <p>{selected.description}</p>}<div><span><CalendarClock size={13} />{format(parseTimestamp(selected.start) ?? new Date(selected.start), 'dd/MM/yyyy HH:mm')}</span>{selected.linkedTaskId && <span>Tarea vinculada: {tasks.find((task) => task.id === selected.linkedTaskId)?.title ?? 'No disponible'}</span>}</div><footer>{selected.linkedTaskId && <Button variant="secondary" onClick={() => navigate('/today')}>Abrir en Hoy</Button>}<Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => { if (!user) return; void calendarEntryRepository.remove(selected.sourceId, user.id).then(() => { setItems((current) => current.filter((item) => item.id !== selected.id)); setSelected(null); setFeedback('Entrada eliminada') }).catch((reason) => setFeedback(reason instanceof Error ? reason.message : 'No se pudo eliminar.')) }}>Eliminar</Button></footer></div></Modal>}
    <ConfirmDialog open={confirmDisconnect} title="Desconectar Google Calendar" description="Los eventos externos dejarán de aparecer. Tus tareas y eventos de FARO no cambiarán." confirmLabel="Desconectar" onClose={()=>setConfirmDisconnect(false)} onConfirm={async()=>{await google.disconnect();setConfirmDisconnect(false);setFeedback('Google Calendar desconectado.')}}/>
  </div>
}

function calendarDayHeader(arg: DayHeaderContentArg) {
  return <div className="calendar-day-header"><span>{format(arg.date, 'EEE', { locale: es })}</span><strong>{format(arg.date, 'd')}</strong></div>
}

function calendarEventContent(arg: EventContentArg) {
  return <div className="calendar-event-content"><time>{arg.timeText}</time><strong>{arg.event.title}</strong><span>{String(arg.event.extendedProps.workspaceName ?? '')}</span></div>
}

function MiniMonthCalendar({ month, selected, onMonthChange, onSelect }: {
  month: Date
  selected: Date
  onMonthChange: (month: Date) => void
  onSelect: (date: Date) => void
}) {
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 0 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 0 }),
  })
  return <section className="calendar-mini-month" aria-label="Calendario mensual">
    <header><strong>{format(month, 'MMMM yyyy', { locale: es })}</strong><div><button aria-label="Mes anterior" onClick={() => onMonthChange(addMonths(month, -1))}><ChevronLeft size={14} /></button><button aria-label="Mes siguiente" onClick={() => onMonthChange(addMonths(month, 1))}><ChevronRight size={14} /></button></div></header>
    <div className="calendar-mini-month__weekdays">{['D', 'L', 'M', 'M', 'J', 'V', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
    <div className="calendar-mini-month__days">{days.map((day) => <button key={day.toISOString()} className={`${!isSameMonth(day, month) ? 'is-outside' : ''} ${isSameDay(day, selected) ? 'is-selected' : ''}`} aria-label={format(day, "d 'de' MMMM 'de' yyyy", { locale: es })} aria-pressed={isSameDay(day, selected)} onClick={() => onSelect(day)}>{format(day, 'd')}</button>)}</div>
  </section>
}
