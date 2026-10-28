import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { ArrowDown, ArrowRight, ArrowUp, CalendarDays, CheckSquare, Ellipsis, Info, Plus, RefreshCw } from 'lucide-react'
import { useContext, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '../../components/common'
import { timestampToLocalParts } from '../../lib/calendarDates'
import { upcoming48Hours } from '../../lib/dashboardMetrics'
import { TaskSyncContext } from '../../providers/TaskSyncContext'
import { formatMxn } from '../../services/financeService'
import type { Task } from '../../types'
import type { CalendarData } from '../calendar/calendarTypes'
import type { FinanceData } from '../finance/financeTypes'
import { parseTaskBrief } from '../planning/taskBrief'
import { paperChartAxisMxn, paperChartDomain, paperFinanceOverview, paperTodayTasks } from './paperDashboardMetrics'
import { PaperVoiceCompanion } from './PaperVoiceCompanion'

interface PaperDashboardProps {
  finance: FinanceData
  financeLoading: boolean
  financeError: string | null
  refreshFinance: () => void
  calendar: CalendarData
  calendarLoading: boolean
  calendarError: string | null
  refreshCalendar: () => void
  tasks: Task[]
  onCreateTask: () => void
  onEditTask: (task: Task) => void
  onCompleteTask: (task: Task) => void
  onRegisterMovement: () => void
  referenceDate?: Date
}

export function PaperDashboard({ finance, financeLoading, financeError, refreshFinance, calendar, calendarLoading, calendarError, refreshCalendar, tasks, onCreateTask, onEditTask, onCompleteTask, onRegisterMovement, referenceDate = new Date() }: PaperDashboardProps) {
  const today = format(referenceDate, 'yyyy-MM-dd')
  const overview = useMemo(() => paperFinanceOverview(finance, parseISO(today)), [finance, today])
  const upcoming = upcoming48Hours(calendar.items, referenceDate).slice(0, 3)
  const todayTasks = paperTodayTasks(tasks, today)
  const taskSync = useContext(TaskSyncContext)
  const { metrics, projection, chart, checkpointDate, checkpointBalanceCents } = overview
  const chartTicks = chart.filter((_day, index) => [0, 7, 14, 21, chart.length - 1].includes(index)).map((day) => day.date)
  const chartDomain = paperChartDomain([...chart.map((day) => day.balance), metrics.availableBalanceCents / 100])
  const activeAccounts = finance.accounts.filter((account) => account.isActive)
  const hasAccounts = activeAccounts.length > 0
  return <div className="paper-dashboard">
    <div className="paper-dashboard__main">
      <header className="paper-home-heading">
        <div><p>{format(referenceDate, "EEEE, d 'de' MMMM 'de' yyyy", { locale: es })}</p>
          <h1>Tu día, en perspectiva.</h1><span>Un día enfocado también es progreso.</span>
        </div>
        <div className="paper-home-heading__actions">
          <Button icon={<Plus size={19} />} onClick={onRegisterMovement}>Registrar movimiento</Button>
          <Button variant="secondary" icon={<CheckSquare size={17} />} onClick={onCreateTask}>Crear tarea</Button>
        </div>
      </header>
      <section className="paper-finance-card" aria-labelledby="paper-finance-title" aria-busy={financeLoading}>
        <header><h2 id="paper-finance-title">Tu situación financiera</h2><Link to="/finance" aria-label="Abrir resumen de Finanzas"><ArrowRight size={17} /></Link></header>
        {financeLoading ? <div className="paper-home-state" role="status"><RefreshCw size={20} className="spin" /><strong>Cargando tu situación financiera…</strong><span>Consultando tus cuentas y movimientos.</span></div>
          : financeError ? <div className="paper-home-state paper-home-state--error" role="alert"><strong>No pudimos cargar tus finanzas</strong><span>{financeError}</span><Button variant="secondary" size="sm" onClick={refreshFinance}>Reintentar</Button></div>
            : !hasAccounts ? <div className="paper-home-state"><strong>Tu resumen empieza con una cuenta</strong><span>Agrega tu saldo inicial para ver tus finanzas y proyecciones.</span><Link to="/finance">Configurar mis cuentas <ArrowRight size={15} /></Link></div>
              : <>
                <div className="paper-finance-metrics">
                  <div className="paper-finance-metrics__available"><span>Disponible operativo <Info size={14} aria-label="Cuentas activas después de ahorro y plan de deudas" /></span>
                    <strong>{formatMxn(metrics.availableBalanceCents)} <small>MXN</small></strong>
                    <p>Cuentas activas · Ahorro · Plan · {format(referenceDate, 'd MMM', { locale: es })}</p>
                  </div>
                  <div className="paper-finance-metrics__flow"><i className="is-income"><ArrowUp size={19} aria-hidden="true" /></i><div><span>Ingresos del mes</span><strong>{formatMxn(metrics.monthlyIncomeCents)} <small>MXN</small></strong></div></div>
                  <div className="paper-finance-metrics__flow"><i className="is-expense"><ArrowDown size={19} aria-hidden="true" /></i><div><span>Gastos del mes</span><strong>{formatMxn(metrics.monthlyExpensesCents)} <small>MXN</small></strong></div></div>
                </div>
                <div className="paper-home-chart"><header><h3>Tu disponible en el tiempo</h3><span><i />Real <i />Proyectado</span></header>
                  <div className="paper-home-chart__canvas" role="img" aria-label={`Disponible operativo real y proyectado durante ${format(referenceDate, 'MMMM', { locale: es })}. Cierre previsto: ${formatMxn(projection.closingBalanceCents)}.`}>
                    <ResponsiveContainer width="100%" height="100%"><ComposedChart data={chart} accessibilityLayer margin={{ top: 16, right: 7, bottom: 4, left: 7 }}>
                      <CartesianGrid vertical={false} stroke="#e3e8ef" strokeDasharray="2 4" />
                      <XAxis dataKey="date" ticks={chartTicks} tickFormatter={(date: string) => format(parseISO(date), 'd MMM', { locale: es })} tickLine={false} axisLine={{ stroke: '#e3e8ef' }} tick={{ fill: '#7a8495', fontSize: 11 }} dy={9} />
                      <YAxis domain={chartDomain} tickFormatter={paperChartAxisMxn} tickCount={4} width={53} tickLine={false} axisLine={false} tick={{ fill: '#7a8495', fontSize: 11 }} />
                      <Tooltip formatter={(amount) => formatMxn(Number(amount) * 100)} labelFormatter={(date) => format(parseISO(String(date)), "d 'de' MMMM", { locale: es })} contentStyle={{ border: '1px solid #dfe4eb', borderRadius: 10, background: '#fff', color: '#17243a', fontSize: 12 }} />
                      <Area isAnimationActive={false} type="monotone" dataKey="balance" fill="#eaf0f8" stroke="none" fillOpacity={0.6} tooltipType="none" name="Disponible" />
                      <Line isAnimationActive={false} type="monotone" dataKey="actual" stroke="#123c72" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="Real" connectNulls={false} />
                      <Line isAnimationActive={false} type="monotone" dataKey="projected" stroke="#123c72" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} name="Proyectado" connectNulls={false} />
                    </ComposedChart></ResponsiveContainer>
                  </div>
                  <dl className="paper-home-projections">
                    <div><dt>Al {format(checkpointDate, "d 'de' MMMM", { locale: es })}</dt><dd>{checkpointBalanceCents == null ? '—' : formatMxn(checkpointBalanceCents)} <small>MXN</small></dd></div>
                    <div><dt>Al cierre del mes</dt><dd>{formatMxn(projection.closingBalanceCents)} <small>MXN</small></dd></div>
                    <div><dt>Mínimo del periodo</dt><dd>{formatMxn(projection.minimumBalanceCents)} <small>MXN</small></dd></div>
                  </dl>
                  <p className="paper-home-chart__note">Proyección con tus compromisos y presupuestos activos. <Link to="/finance" onClick={() => sessionStorage.setItem('faro-finance-panel', 'advisor')}>Ver detalle</Link></p>
                </div>
              </>}
      </section>
      <div className="paper-home-lists">
        <section className="paper-home-list" aria-labelledby="paper-agenda-title"><header><h2 id="paper-agenda-title">Lo que sigue</h2><Link to="/calendar">Ver calendario <ArrowRight size={15} /></Link></header>
          {calendarLoading && !calendar.items.length ? <p className="paper-list-state" role="status">Cargando tu agenda…</p>
            : calendarError ? <div className="paper-list-state" role="alert"><p>No pudimos actualizar tu agenda.</p><button type="button" onClick={refreshCalendar}>Reintentar</button></div>
              : upcoming.length ? <ul>{upcoming.map((item) => <li key={item.id}><Link className="paper-agenda-item" to="/calendar">
                <span className="paper-agenda-item__icon"><CalendarDays size={21} aria-hidden="true" /></span>
                <time>{item.allDay ? 'Todo el día' : timestampToLocalParts(item.start).time}<small>{item.start.slice(0, 10) !== today ? format(parseISO(item.start), 'd MMM', { locale: es }) : ''}</small></time>
                <span><strong>{item.title}</strong><small>{item.description || item.calendarName || (item.sourceType === 'task' ? 'Tarea programada' : 'Evento en tu agenda')}</small></span><ArrowRight size={15} aria-hidden="true" />
              </Link></li>)}</ul> : <div className="paper-list-state"><p>Sin compromisos en las próximas 48 horas.</p><Link to="/calendar?quick=event">Planificar mi siguiente paso <ArrowRight size={14} /></Link></div>}
        </section>
        <section className="paper-home-list" aria-labelledby="paper-tasks-title"><header><h2 id="paper-tasks-title">Pendientes de hoy</h2><Link to="/backlog">Ver todos <ArrowRight size={15} /></Link></header>
          {taskSync?.state === 'error' && <div className="paper-list-notice" role="alert"><span>No pudimos sincronizar. Mostramos lo guardado en este dispositivo.</span><button type="button" onClick={taskSync.retry}>Reintentar</button></div>}
          {(taskSync?.state === 'syncing' || taskSync?.state === 'idle') && !tasks.length ? <p className="paper-list-state" role="status">Cargando tus pendientes…</p>
            : todayTasks.length ? <ul>{todayTasks.map((task) => { const brief = parseTaskBrief(task.description || task.notes); const detail = task.waitingFor ? `En espera de ${task.waitingFor}` : task.blockerReason || brief.objective || brief.currentBehavior || (task.status === 'doing' ? 'En progreso' : task.dueDate && task.dueDate < today ? 'Pendiente de días anteriores' : 'Programada para hoy'); return <li className="paper-task-item" key={task.id}>
              <input type="checkbox" checked={false} aria-label={`Completar ${task.title}`} onChange={() => onCompleteTask(task)} />
              <button type="button" className="paper-task-item__copy" onClick={() => onEditTask(task)}><strong>{task.title}</strong><span>{detail}</span></button>
              <button type="button" className="paper-task-item__edit" aria-label={`Editar ${task.title}`} onClick={() => onEditTask(task)}><Ellipsis size={17} /></button>
            </li> })}</ul> : <div className="paper-list-state"><p>No tienes tareas pendientes para hoy.</p><button type="button" onClick={onCreateTask}>Crear una tarea <Plus size={14} /></button></div>}
        </section>
      </div>
    </div>
    <PaperVoiceCompanion />
  </div>
}
