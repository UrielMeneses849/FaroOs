import { differenceInMinutes, endOfMonth, format, parseISO, subMonths } from 'date-fns'
import { es } from 'date-fns/locale'
import { ArrowUpRight, Cloud, Coffee, Database, Gift, HardDrive, Landmark, Plus, Scale, ShieldCheck, Utensils, WalletCards } from 'lucide-react'
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { Button, EmptyState, Modal } from '../../components/common'
import { PageHeader } from '../../components/layout'
import { ExpenseCategoryDonut } from '../finance/ExpenseCategoryDonut'
import { useCalendarData } from '../../hooks/useCalendarData'
import { useFinance } from '../../hooks/useFinance'
import { useHealthRecords } from '../../hooks/useHealthRecords'
import { useWorkspaces } from '../../hooks/useWorkspaces'
import { localDate, timestampToLocalParts } from '../../lib/calendarDates'
import { upcoming48Hours, weightRegistrationIsStale, workspaceOpenLoad } from '../../lib/dashboardMetrics'
import { accountBalance, calculateFinanceMetrics, formatMxn, spentTodayCents } from '../../services/financeService'
import { useFaroStore } from '../../store'
import type { HealthLog } from '../../types'
import { getDesktopStorageCapacity, isFaroDesktop } from '../../desktop/desktopBridge'
import type { StorageCapacity } from '../storage/storageTypes'
import { getSupabaseDatabaseCapacity, type SupabaseDatabaseCapacity } from '../storage/supabaseCapacity'

const workspaceAccents: Record<string, string> = {
  personal: '#35c78a', bbva: '#2457ff', bimsa: '#f28c38', nexvora: '#a970ff',
  portfolio: '#c7a34b', 'faro os': '#2ab7ca',
}

function compactBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  // macOS System Settings uses decimal units. Matching it here prevents a
  // correct `df` reading from looking 7% smaller than the system surface.
  if (bytes >= 1000 ** 3) return `${(bytes / 1000 ** 3).toFixed(bytes >= 100 * 1000 ** 3 ? 0 : 1)} GB`
  if (bytes >= 1000 ** 2) return `${Math.round(bytes / 1000 ** 2)} MB`
  return `${Math.round(bytes / 1000)} KB`
}

function ratio(value: number, total: number) {
  return Math.min(100, Math.max(0, Math.round(value / Math.max(1, total) * 100)))
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { data: workspaces } = useWorkspaces()
  const { data: finance } = useFinance()
  const { data: calendar, error: calendarError, refresh: refreshCalendar } = useCalendarData()
  const { logs: healthLogs, save: saveHealth } = useHealthRecords()
  const tasks = useFaroStore((state) => state.tasks)
  const [weightOpen, setWeightOpen] = useState(false)
  const [recentLimit, setRecentLimit] = useState(12)
  const [maintenanceOpen, setMaintenanceOpen] = useState(false)
  const [macCapacity, setMacCapacity] = useState<StorageCapacity>()
  const [macCapacityError, setMacCapacityError] = useState('')
  const [supabaseCapacity, setSupabaseCapacity] = useState<SupabaseDatabaseCapacity>()
  const [supabaseCapacityError, setSupabaseCapacityError] = useState('')
  const today = localDate()
  const month = parseISO(`${today.slice(0, 7)}-01`)
  const metrics = calculateFinanceMetrics(finance, month)
  const previousEnd = format(endOfMonth(subMonths(month, 1)), 'yyyy-MM-dd')
  const previousTransactions = finance.transactions.filter((item) => item.transactionDate <= previousEnd)
  const previousAvailable = finance.accounts.filter((account) => account.isActive).reduce((sum, account) => sum + accountBalance(account, previousTransactions), 0)
    - previousTransactions.filter((item) => item.status === 'completed' && item.type === 'saving').reduce((sum, item) => sum + item.amountCents, 0)
  const hasPrevious = previousTransactions.length > 0
  const availableVariation = hasPrevious && previousAvailable ? (metrics.availableBalanceCents - previousAvailable) / Math.abs(previousAvailable) * 100 : undefined
  const upcoming = upcoming48Hours(calendar.items)
  const workspaceRows = workspaceOpenLoad(tasks, workspaces, today)
  const expenseByCategory = finance.categories.map((category) => ({
    name: category.name,
    value: finance.transactions.filter((item) => item.categoryId === category.id && item.transactionDate.startsWith(today.slice(0, 7)) && item.status === 'completed' && (item.type === 'expense' || item.type === 'debt_payment')).reduce((sum, item) => sum + item.amountCents, 0),
  })).filter((item) => item.value > 0).sort((a, b) => b.value - a.value)
  const todayExpenses = spentTodayCents(finance.transactions, today)
  const recentTransactions = [...finance.transactions].sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.createdAt.localeCompare(a.createdAt)).slice(0, recentLimit)
  const latestWeight = [...healthLogs].filter((item) => item.weightKg != null).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.updatedAt.localeCompare(a.updatedAt))[0]
  const weightHistory = [...healthLogs].filter((item) => item.weightKg != null).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).slice(-30).map((item) => ({
    date: format(parseISO(item.occurredAt.slice(0, 10)), 'd MMM', { locale: es }),
    weight: item.weightKg,
  }))
  const startingWeight = weightHistory[0]?.weight
  const weightChange = latestWeight?.weightKg != null && startingWeight != null ? latestWeight.weightKg - startingWeight : undefined
  const weightStale = weightRegistrationIsStale(latestWeight?.occurredAt, today)

  useEffect(() => {
    let disposed = false
    if (isFaroDesktop()) {
      void getDesktopStorageCapacity()
        .then((capacity) => { if (!disposed && capacity) setMacCapacity(capacity) })
        .catch(() => { if (!disposed) setMacCapacityError('No pude medir este disco.') })
    }
    void getSupabaseDatabaseCapacity()
      .then((capacity) => { if (!disposed) setSupabaseCapacity(capacity) })
      .catch(() => { if (!disposed) setSupabaseCapacityError('Medición pendiente.') })
    return () => { disposed = true }
  }, [])

  const openMovements = () => {
    sessionStorage.setItem('faro-finance-panel', 'transactions')
    navigate('/finance')
  }

  return <div className="page dashboard-page dashboard-ops">
    <div className="dashboard-voice-heading"><PageHeader eyebrow={format(new Date(), "EEEE, d 'de' MMMM", { locale: es })} title="Dashboard" voiceSurface="dashboard" showVoice={false} /></div>
    <div className="dashboard-command">
      <main className="dashboard-command__main">
        <section className="ops-panel ops-calendar"><PanelHead eyebrow="Próximos compromisos" title="" to="/calendar" label="Abrir calendario" />{calendarError ? <EmptyState title="Calendario no disponible" description={calendarError} action={<Button onClick={refreshCalendar}>Reintentar</Button>} /> : <><div className="ops-timeline">{upcoming.map((item, index) => { const workspace = workspaces.find((candidate) => candidate.id === item.workspaceId); const parts = timestampToLocalParts(item.start); const rawMinutes = item.end ? differenceInMinutes(parseISO(item.end), parseISO(item.start)) : undefined; const minutes = rawMinutes && rawMinutes > 0 && rawMinutes <= 1440 ? rawMinutes : undefined; const context=item.source==='google'?(item.calendarName??'Google'):workspace?.name??'Sin workspace'; const kind = item.source === 'google' || item.sourceType === 'event' ? 'Evento' : 'Tarea'; return <article key={item.id} data-state="upcoming" data-kind={kind.toLowerCase()} data-current={index === 0}><i /><time><span>{kind}</span>{item.allDay ? 'Todo el día' : parts.time}</time><div><strong>{item.title}</strong><span>{context} · {item.source==='google'?'Google':item.sourceType === 'event' ? item.entryKind === 'focus' ? 'Enfoque' : 'Evento' : 'Tarea'}{minutes ? ` · ${minutes} min` : ''}</span></div></article>})}{!upcoming.length && <p>No tienes compromisos en las próximas 48 horas.</p>}</div><div className="ops-timeline__legend" aria-hidden="true"><span><i />Evento</span><span><i />Tarea</span></div></>}</section>
        <section className="dashboard-capacity-stack" aria-label="Capacidad y mantenimiento de datos">
          <button className={`dashboard-capacity-card dashboard-capacity-card--mac${macCapacity ? ` is-${macCapacity.health}` : ''}`} type="button" onClick={() => navigate('/storage')}>
            <header><span><HardDrive size={14} aria-hidden="true" /> Mac</span><ArrowUpRight size={13} aria-hidden="true" /></header>
            {macCapacity ? <><strong>{compactBytes(macCapacity.freeBytes)}</strong><small>libres de {compactBytes(macCapacity.totalBytes)}</small><div className="dashboard-capacity-card__meter" aria-hidden="true"><i style={{ width: `${ratio(macCapacity.usedBytes, macCapacity.totalBytes)}%` }} /></div><p>{macCapacity.freeBytes >= macCapacity.minimumOperatingFreeBytes ? 'Margen operativo protegido' : `Faltan ${compactBytes(macCapacity.minimumOperatingFreeBytes - macCapacity.freeBytes)} para el margen`}</p></> : <><strong>{macCapacityError ? 'Sin lectura' : 'Midiendo…'}</strong><small>Capacidad local</small><p>{macCapacityError || 'Sin recorrer tus archivos'}</p></>}
          </button>
          <button className={`dashboard-capacity-card dashboard-capacity-card--supabase${supabaseCapacity ? ` is-${supabaseCapacity.health}` : ''}`} type="button" onClick={() => setMaintenanceOpen(true)}>
            <header><span><Database size={14} aria-hidden="true" /> Supabase</span><ShieldCheck size={13} aria-hidden="true" /></header>
            {supabaseCapacity ? <><strong>{compactBytes(supabaseCapacity.databaseBytes)}</strong><small>de {compactBytes(supabaseCapacity.limitBytes)} · plan Free</small><div className="dashboard-capacity-card__meter" aria-hidden="true"><i style={{ width: `${ratio(supabaseCapacity.databaseBytes, supabaseCapacity.limitBytes)}%` }} /></div><p>{supabaseCapacity.health === 'calm' ? 'Alerta preventiva al 70%' : supabaseCapacity.health === 'attention' ? 'Conviene revisar retención' : 'Requiere mantenimiento pronto'}</p></> : <><strong>{supabaseCapacityError ? 'Sin lectura' : 'Midiendo…'}</strong><small>Base de datos del proyecto</small><p>{supabaseCapacityError || 'Consulta segura de capacidad'}</p></>}
          </button>
        </section>
        <section className="ops-panel ops-execution"><PanelHead eyebrow="Estado de workspaces" title="" to="/backlog" label="Abrir backlog" /><div className="ops-treemap">{workspaceRows.map((row) => <button key={row.workspace.id} style={{ '--workspace-color': workspaceAccents[row.workspace.name.toLowerCase()] ?? '#74747d' } as CSSProperties} data-overdue={row.overdue > 0} data-empty={row.open === 0} onClick={() => navigate(`/backlog?workspace=${row.workspace.id}`)}><strong>{row.workspace.name}</strong><b>{row.open}</b><span>{row.doing > 0 ? `${row.doing} en curso` : row.overdue > 0 ? `${row.overdue} vencida${row.overdue === 1 ? '' : 's'}` : row.open ? `${row.pending} pendientes` : 'Sin pendientes'}</span></button>)}</div></section>
        <section className="ops-panel ops-finance"><PanelHead eyebrow="Finanzas" title="Gasto por categoría" to="/finance" label="Abrir Finanzas" /><ExpenseCategoryDonut variant="dashboard" data={expenseByCategory} emptyDescription="La distribución aparecerá al registrar gastos." /></section>
        <section className="ops-panel ops-health"><PanelHead eyebrow="Salud" title="Peso" to="/health" label="Abrir Salud" /><div className="ops-health-action"><Scale /><div><span>Último peso</span><strong>{latestWeight?.weightKg ? `${latestWeight.weightKg} kg` : 'Sin registro'}</strong><small className={weightChange == null ? '' : weightChange <= 0 ? 'positive' : 'negative'}>{weightChange == null ? latestWeight?.occurredAt ? `Registrado el ${latestWeight.occurredAt.slice(0, 10)}` : 'Comienza tu historial de peso' : `${weightChange <= 0 ? '↓' : '↑'} ${Math.abs(weightChange).toFixed(1)} kg desde el inicio`}</small></div></div>{weightHistory.length ? <div className="dashboard-weight-chart" aria-label="Evolución reciente del peso"><ResponsiveContainer width="100%" height="100%"><LineChart data={weightHistory} accessibilityLayer margin={{ top: 8, right: 12, bottom: 0, left: 0 }}><CartesianGrid stroke="#1d2833" vertical={false} /><XAxis dataKey="date" stroke="#7d8795" tickLine={false} axisLine={false} fontSize={9} minTickGap={24} /><YAxis dataKey="weight" domain={['dataMin - 1', 'dataMax + 1']} stroke="#7d8795" tickLine={false} axisLine={false} fontSize={9} width={30} /><Line type="monotone" dataKey="weight" stroke="#2d72ff" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: '#eef4ff', stroke: '#2d72ff', strokeWidth: 2 }} /></LineChart></ResponsiveContainer></div> : <p className="dashboard-weight-empty">Registra tu peso para mostrar la evolución.</p>}{weightStale && <div className="ops-health-alert"><span>No has registrado tu peso recientemente</span><Button size="sm" onClick={() => setWeightOpen(true)}>Registrar peso</Button></div>}</section>
      </main>
      <aside className="dashboard-finance-sidebar">
        <section className="finance-side-balance"><header><span>Resumen financiero</span><WalletCards size={18} /></header><small>Disponible operativo</small><strong>{formatMxn(metrics.availableBalanceCents)}</strong>{availableVariation != null && <em className={availableVariation >= 0 ? 'positive' : 'negative'}>{availableVariation >= 0 ? '+' : ''}{availableVariation.toFixed(1)}% respecto al periodo anterior</em>}<p>Dinero activo después de gastos y ahorro apartado.</p><div className="dashboard-spend-today"><span>Gastado hoy</span><b>{formatMxn(todayExpenses)}</b></div><dl><div><dt>Ingresos del periodo</dt><dd>{formatMxn(metrics.monthlyIncomeCents)}</dd></div><div><dt>Gastos del periodo</dt><dd>{formatMxn(metrics.monthlyExpensesCents)}</dd></div><div><dt>Balance real</dt><dd>{formatMxn(metrics.actualBalanceCents)}</dd></div></dl><Button size="sm" icon={<Plus size={14} />} onClick={openMovements}>Registrar movimiento</Button></section>
        <section className="finance-side-recent"><header><span>Movimientos recientes</span><button onClick={openMovements}>Ver todos</button></header><div className="finance-side-recent__list" tabIndex={0} aria-label="Movimientos recientes">{recentTransactions.map((item) => { const category = finance.categories.find((candidate) => candidate.id === item.categoryId)?.name ?? item.type; return <article key={item.id} data-type={item.type}><MovementIcon category={category} /><div><strong title={item.description}>{item.description}</strong><span>{category} · {item.transactionDate}</span></div><b>{item.type === 'income' || item.type === 'refund' ? '+' : item.type === 'transfer' ? '' : '−'}{formatMxn(item.amountCents)}</b><small>{item.status}</small></article>})}{!recentTransactions.length && <p>Sin movimientos todavía.</p>}{recentLimit < finance.transactions.length && <Button size="sm" variant="ghost" onClick={() => setRecentLimit((limit) => limit + 12)}>Mostrar más movimientos</Button>}</div></section>
      </aside>
    </div>
    {weightOpen && <QuickWeightDialog onClose={() => setWeightOpen(false)} onSave={saveHealth} />}
    {maintenanceOpen && <DataMaintenanceDialog onClose={() => setMaintenanceOpen(false)} supabaseCapacity={supabaseCapacity} />}
  </div>
}
function QuickWeightDialog({ onClose, onSave }: { onClose: () => void; onSave: (log: HealthLog) => Promise<HealthLog> }) {
  const [weight, setWeight] = useState('')
  const [date, setDate] = useState(localDate())
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault(); const value = Number(weight)
    if (!Number.isFinite(value) || value < 20 || value > 400) { setError('Ingresa un peso válido.'); return }
    const now = new Date().toISOString(); setSaving(true); setError('')
    try { await onSave({ id: crypto.randomUUID(), area: 'health', occurredAt: date, energy: 7, weightKg: value, notes: notes || undefined, createdAt: now, updatedAt: now }); onClose() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar el peso.') }
    finally { setSaving(false) }
  }
  return <Modal open title="Registrar peso" onClose={onClose}><form className="tracker-form" onSubmit={submit}><label>Peso (kg)<input autoFocus required type="number" min="20" max="400" step=".1" value={weight} onChange={(event) => setWeight(event.target.value)} /></label><label>Fecha<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Nota <span>opcional</span><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>{error && <p className="field-error" role="alert">{error}</p>}<div className="modal-actions"><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button></div></form></Modal>
}

function DataMaintenanceDialog({ onClose, supabaseCapacity }: { onClose: () => void; supabaseCapacity?: SupabaseDatabaseCapacity }) {
  return <Modal open title="Mantenimiento de datos" onClose={onClose}>
    <div className="dashboard-maintenance-dialog">
      <p>FARO no borra datos de negocio por antigüedad. Esta estrategia protege finanzas, salud, agenda, Vault y tus archivos archivados.</p>
      <article><span>01 · Cada semana</span><strong>Mac: revisar capturas, descargas y temporales</strong><small>Primero archiva o mueve a Papelera desde Espacio; nunca se elimina sin revisión.</small></article>
      <article><span>02 · Cada mes</span><strong>Supabase: revisar telemetría y acciones de voz</strong><small>La próxima limpieza deberá ofrecer un preflight y confirmación para logs operativos antiguos; no tocará diarios, finanzas ni credenciales.</small></article>
      <article><span>03 · Antes del límite</span><strong>{supabaseCapacity ? `${compactBytes(supabaseCapacity.databaseBytes)} de ${compactBytes(supabaseCapacity.limitBytes)} medidos` : 'Medición de proyecto pendiente'}</strong><small>FARO avisa al 70%, pide una revisión al 80% y nunca ejecuta una purga automática.</small></article>
    </div>
    <div className="modal-actions"><Button type="button" onClick={onClose}>Entendido</Button></div>
  </Modal>
}

function PanelHead({ eyebrow, title, to, label }: { eyebrow: string; title: string; to?: string; label?: string }) {
  return <header className="ops-panel__head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{to && <Link to={to}>{label}<ArrowUpRight size={12} /></Link>}</header>
}

function MovementIcon({ category }: { category: string }) {
  const normalized = category.toLowerCase()
  return <span className="finance-side-recent__icon" aria-hidden="true">
    {normalized.includes('comida') || normalized.includes('café') ? <Coffee size={15} />
      : normalized.includes('préstamo') ? <Landmark size={15} />
        : normalized.includes('suscrip') ? <Gift size={15} />
          : normalized.includes('personal') ? <Cloud size={15} />
            : normalized.includes('restaurante') ? <Utensils size={15} />
              : <WalletCards size={15} />}
  </span>
}
