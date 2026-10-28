import { CalendarDays, ChevronRight, Plus, RefreshCw, Undo2, WalletCards } from 'lucide-react'
import { useContext, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { useFinance } from '../../hooks/useFinance'
import { useCalendarData } from '../../hooks/useCalendarData'
import { useFaroStore } from '../../store'
import { TaskSyncContext } from '../../providers/TaskSyncContext'
import { calculateFinanceMetrics, formatMxn } from '../../services/financeService'
import { timestampToLocalParts } from '../../lib/calendarDates'
import type { Task } from '../../types'
import { TaskFormDialog } from '../planning/PlanningDialogs'
import { QuickCaptureDialog } from '../capture/QuickCaptureDialog'
import { useOptionalFaroVoice } from '../voice/FaroVoiceProvider'
import orbUrl from '../../assets/faro-orb-v1.png'
import { DayFocusGadget } from './DayFocusGadget'
import { commitmentTiming, dayPriorities, nextDayCommitment } from './dayGadgetData'
import './mobile-day-dashboard.css'

export function MobileDayDashboard() {
  const finance = useFinance()
  const calendar = useCalendarData()
  const tasks = useFaroStore(state => state.tasks)
  const updateTask = useFaroStore(state => state.updateTask)
  const sync = useContext(TaskSyncContext)
  const voice = useOptionalFaroVoice()
  const [now, setNow] = useState(() => new Date())
  const [editing, setEditing] = useState<Task>()
  const [completed, setCompleted] = useState<Task>()
  const [capture, setCapture] = useState(false)
  const today = format(now, 'yyyy-MM-dd')
  const priorities = useMemo(() => dayPriorities(tasks, parseISO(today)), [tasks, today])
  const next = useMemo(() => nextDayCommitment(calendar.data.items, now), [calendar.data.items, now])
  const metrics = useMemo(() => calculateFinanceMetrics(finance.data, parseISO(today), parseISO(today)), [finance.data, today])
  const hasAccounts = finance.data.accounts.some(account => account.isActive)
  const agendaError = calendar.error || calendar.google?.error
  const agendaLoading = calendar.loading || calendar.google?.loading
  const clock = next && !next.allDay ? timestampToLocalParts(next.start).time : ''
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined
    const tick = () => setNow(new Date())
    const resume = () => { clearInterval(interval); if (document.visibilityState !== 'hidden') { tick(); interval = setInterval(tick, 30_000) } }
    resume()
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('pageshow', resume)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', resume); window.removeEventListener('pageshow', resume) }
  }, [])
  const complete = (task: Task) => { updateTask(task.id, { status: 'done' }); setCompleted(task) }
  const undo = () => {
    if (completed && useFaroStore.getState().tasks.find(task => task.id === completed.id)?.status === 'done') updateTask(completed.id, { status: completed.status })
    setCompleted(undefined)
  }
  return <div className="page dashboard-page mobile-day-dashboard">
    <header className="day-heading"><h1>Mi día</h1><p><time dateTime={today}>{format(now, "EEEE, d 'de' MMMM", { locale: es })}</time></p></header>
    <section className="day-next day-gadget" aria-labelledby="day-next-title" aria-busy={Boolean(agendaLoading)}>
      <h2 id="day-next-title">Lo siguiente</h2>
      {agendaLoading && !next ? <p className="day-state" role="status">Cargando tu agenda…</p>
        : next ? <Link className="day-next__event" to="/calendar" aria-label={`Ver en calendario: ${next.title}`}><div><strong>{next.title}</strong><span><CalendarDays size={18} aria-hidden="true" />{clock && <time dateTime={next.start}>{clock}</time>}{clock && <i aria-hidden="true">·</i>}<b>{commitmentTiming(next, now)}</b></span></div><ChevronRight size={24} aria-hidden="true" /></Link>
          : agendaError ? <div className="day-state" role="alert"><p>No pudimos actualizar tu agenda.</p><button type="button" onClick={() => void calendar.forceRefresh()}>Reintentar</button></div>
            : <div className="day-state"><strong>Tu agenda tiene espacio</strong><Link to="/calendar?quick=event">Planificar un compromiso <ChevronRight size={15} /></Link></div>}
      {agendaError && next && <p className="day-cache-notice" role="status">Agenda guardada. <button type="button" onClick={() => void calendar.forceRefresh()}>Actualizar</button></p>}
    </section>
    <section className="day-priorities day-gadget" aria-labelledby="day-priorities-title">
      <header><h2 id="day-priorities-title">Mis 3 prioridades</h2><Link to="/backlog" aria-label="Ver todos mis pendientes"><ChevronRight size={16} /></Link></header>
      {sync?.state === 'error' && <p className="day-sync-notice" role="alert">Hay cambios por sincronizar. <button type="button" onClick={sync.retry}>Reintentar</button></p>}
      {(sync?.state === 'syncing' || sync?.state === 'idle') && !tasks.length ? <p className="day-state" role="status">Cargando tus prioridades…</p>
        : priorities.length ? <ul>{priorities.map(task => <li key={task.id}><label className="day-priority-check"><input type="checkbox" checked={false} onChange={() => complete(task)} aria-label={`Completar ${task.title}`} /></label><button type="button" className="day-priority-title" onClick={() => setEditing(task)} aria-label={`Editar ${task.title}`}>{task.title}</button></li>)}</ul>
          : <div className="day-state"><strong>Todo listo por hoy</strong><Link to="/backlog?quick=task">Elegir mi siguiente paso <Plus size={15} /></Link></div>}
    </section>
    {completed && <div className="day-undo" role="status"><span>Completaste «{completed.title}».</span><button type="button" onClick={undo}><Undo2 size={14} />Deshacer</button><button type="button" aria-label="Cerrar aviso de tarea completada" onClick={() => setCompleted(undefined)}>Cerrar</button></div>}
    <div className="day-mini-grid">
      <section className="day-mini day-money" data-long-amount={formatMxn(metrics.availableBalanceCents).length > 10} aria-labelledby="day-money-title" aria-busy={finance.loading}>
        <header><h2 id="day-money-title">Disponible</h2><WalletCards size={20} aria-hidden="true" /></header>
        {finance.loading && !hasAccounts ? <span className="day-money__state" role="status">Consultando…</span>
          : finance.error && !hasAccounts ? <span className="day-money__state" role="alert">Sin lectura <button type="button" onClick={() => void finance.refresh()}><RefreshCw size={14} />Reintentar</button></span>
            : !hasAccounts ? <span className="day-money__state">Agrega tu primera cuenta</span>
              : <><strong className="day-mini__value">{formatMxn(metrics.availableBalanceCents)}</strong>{finance.error && <small className="day-cache-notice">Última lectura</small>}</>}
        <Link to="/finance" onClick={() => sessionStorage.setItem('faro-finance-panel', 'overview')}>Ver finanzas <ChevronRight size={16} /></Link>
      </section>
      <DayFocusGadget key={finance.user?.id ?? 'guest'} ownerId={finance.user?.id} />
    </div>
    <button className="day-capture" type="button" onClick={() => setCapture(true)}><img src={orbUrl} alt="" aria-hidden="true" /><span>Capturar con FARO</span></button>
    {editing && <TaskFormDialog open initial={editing} onClose={() => setEditing(undefined)} />}
    {capture && <QuickCaptureDialog open onClose={() => setCapture(false)} onVoice={voice?.enabled ? () => { setCapture(false); voice.openFaroVoice({ surface: 'dashboard' }) } : undefined} />}
  </div>
}
