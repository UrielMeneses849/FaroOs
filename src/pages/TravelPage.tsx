import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { CalendarDays, CheckCircle2, Circle, MapPin, Plane, Plus, WalletCards } from 'lucide-react'
import { useCallback, useState, type FormEvent, type ReactNode } from 'react'
import { Button, EmptyState, Modal, ProgressBar } from '../components/common'
import { PageHeader } from '../components/layout'
import { useRepositoryList } from '../hooks/useRepositoryList'
import { usePageCapture } from '../hooks/usePageCapture'
import {
  travelBudgetRepository, travelChecklistRepository, travelDestinationRepository,
  travelItineraryRepository, travelReservationRepository, travelTripRepository,
} from '../repositories/growthRepositories'
import type { Database } from '../types/database.types'

type Tables = Database['public']['Tables']
type Trip = Tables['travel_trips']['Row']
type Tab = 'dashboard' | 'destinations' | 'budget' | 'itinerary' | 'reservations' | 'checklist'
const tripStatuses = { idea: 'Idea', planning: 'En planeación', booked: 'Reservado', active: 'En curso', completed: 'Completado', cancelled: 'Cancelado' }
const money = (value: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(value)

export function TravelPage() {
  const loadTrips = useCallback((userId: string) => travelTripRepository.list(userId), [])
  const { capture } = usePageCapture()
  const { data: trips, loading, error, refresh, user } = useRepositoryList(loadTrips)
  const [selectedId, setSelectedId] = useState<string>()
  const [editing, setEditing] = useState<Trip>()
  const selected = trips.find((trip) => trip.id === selectedId)
  const saveTrip = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!user || !editing) return
    await travelTripRepository.save({ ...editing, user_id: user.id }, user.id)
    setEditing(undefined); await refresh()
  }
  if (selected) return <TripWorkspace trip={selected} onBack={() => setSelectedId(undefined)} onRefresh={refresh} />
  return <div className="page growth-page"><PageHeader eyebrow="Vida en movimiento" title="Viajes" description="Planea destinos, presupuesto y próximos pasos en un solo lugar." onCapture={capture} />
    <div className="growth-toolbar"><div><strong>{trips.filter((item) => ['planning', 'booked', 'active'].includes(item.status)).length}</strong><span>viajes en preparación</span></div><Button icon={<Plus size={16} />} onClick={() => setEditing(newTrip())}>Crear viaje</Button></div>
    {loading && !trips.length ? <div className="planning-skeleton">Sincronizando viajes…</div> : error ? <EmptyState title="No pudimos cargar Viajes" description={error} action={<Button onClick={refresh}>Reintentar</Button>} /> :
      trips.length ? <section className="travel-grid">{trips.map((trip) => <article key={trip.id} className="travel-card"><div className="travel-card__visual"><Plane /><span>{trip.status}</span></div><div><h2>{trip.name}</h2><p>{trip.description || 'Sin descripción todavía.'}</p><dl><div><dt>Fechas</dt><dd>{trip.start_date ? format(parseISO(trip.start_date), 'dd MMM yyyy') : 'Por definir'}</dd></div><div><dt>Presupuesto</dt><dd>{money(Number(trip.budget_total))}</dd></div></dl><ProgressBar value={trip.status === 'completed' ? 100 : trip.status === 'booked' ? 70 : trip.status === 'planning' ? 35 : 10} /><footer><Button onClick={() => setSelectedId(trip.id)}>Abrir</Button><Button variant="ghost" onClick={() => setEditing(trip)}>Editar</Button></footer></div></article>)}</section>
        : <EmptyState title="Tu próxima historia empieza aquí" description="Crea un viaje para comenzar a ordenar fechas, reservas y presupuesto." action={<Button onClick={() => setEditing(newTrip())}>Crear viaje</Button>} />}
    {editing && <Modal open title={trips.some((item) => item.id === editing.id) ? 'Editar viaje' : 'Crear viaje'} onClose={() => setEditing(undefined)}><form className="growth-form" onSubmit={saveTrip}><label>Nombre<input autoFocus required value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label><label>Descripción<textarea rows={3} value={editing.description ?? ''} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label><div><label>Estado<select value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value as Trip['status'] })}>{Object.entries(tripStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Origen<input value={editing.origin ?? ''} onChange={(event) => setEditing({ ...editing, origin: event.target.value })} /></label></div><div><label>Inicio<input type="date" value={editing.start_date ?? ''} onChange={(event) => setEditing({ ...editing, start_date: event.target.value || null })} /></label><label>Fin<input type="date" min={editing.start_date ?? undefined} value={editing.end_date ?? ''} onChange={(event) => setEditing({ ...editing, end_date: event.target.value || null })} /></label></div><div><label>Presupuesto<input type="number" min="0" value={editing.budget_total} onChange={(event) => setEditing({ ...editing, budget_total: Number(event.target.value) })} /></label><label>Viajeros<input type="number" min="1" max="99" value={editing.travelers} onChange={(event) => setEditing({ ...editing, travelers: Number(event.target.value) })} /></label></div><div className="modal-actions"><Button type="button" variant="ghost" onClick={() => setEditing(undefined)}>Cancelar</Button><Button type="submit">Guardar</Button></div></form></Modal>}
  </div>
}

function newTrip(): Trip {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), user_id: '', name: '', description: null, status: 'idea', start_date: null, end_date: null, origin: null, currency: 'MXN', budget_total: 0, travel_style: null, travelers: 1, cover_image_url: null, archived_at: null, created_at: now, updated_at: now }
}

function TripWorkspace({ trip, onBack, onRefresh }: { trip: Trip; onBack: () => void; onRefresh: () => Promise<void> }) {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [dialog, setDialog] = useState<Exclude<Tab, 'dashboard'>>()
  const [feedback, setFeedback] = useState('')
  const loaders = {
    destinations: useCallback((u: string) => travelDestinationRepository.list(u).then((rows) => rows.filter((row) => row.trip_id === trip.id)), [trip.id]),
    budget: useCallback((u: string) => travelBudgetRepository.list(u).then((rows) => rows.filter((row) => row.trip_id === trip.id)), [trip.id]),
    itinerary: useCallback((u: string) => travelItineraryRepository.list(u).then((rows) => rows.filter((row) => row.trip_id === trip.id)), [trip.id]),
    reservations: useCallback((u: string) => travelReservationRepository.list(u).then((rows) => rows.filter((row) => row.trip_id === trip.id)), [trip.id]),
    checklist: useCallback((u: string) => travelChecklistRepository.list(u).then((rows) => rows.filter((row) => row.trip_id === trip.id)), [trip.id]),
  }
  const destinations = useRepositoryList(loaders.destinations), budget = useRepositoryList(loaders.budget)
  const itinerary = useRepositoryList(loaders.itinerary), reservations = useRepositoryList(loaders.reservations)
  const checklist = useRepositoryList(loaders.checklist)
  const spent = budget.data.reduce((sum, item) => sum + Number(item.paid), 0)
  const completed = checklist.data.filter((item) => item.completed).length
  const days = trip.start_date ? differenceInCalendarDays(parseISO(trip.start_date), new Date()) : null
  const refreshAll = async () => { await Promise.all([destinations.refresh(), budget.refresh(), itinerary.refresh(), reservations.refresh(), checklist.refresh(), onRefresh()]) }
  return <div className="page growth-page trip-workspace"><button className="text-action" onClick={onBack}>← Todos los viajes</button><header className="trip-hero"><div><span className="eyebrow">{tripStatuses[trip.status as keyof typeof tripStatuses]}</span><h1>{trip.name}</h1><p>{trip.description}</p></div><strong>{days == null ? 'Sin fecha' : days > 0 ? `${days} días` : days === 0 ? 'Hoy' : 'En curso'}</strong></header>
    <nav className="growth-tabs">{(['dashboard', 'destinations', 'budget', 'itinerary', 'reservations', 'checklist'] as Tab[]).map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{({ dashboard: 'Resumen', destinations: 'Destinos', budget: 'Presupuesto', itinerary: 'Itinerario', reservations: 'Reservas', checklist: 'Checklist' })[item]}</button>)}</nav>
    {feedback && <div className="kanban-feedback" role="status">{feedback}</div>}
    {tab === 'dashboard' && <><section className="growth-metrics"><Metric icon={<CalendarDays />} label="Cuenta regresiva" value={days == null ? 'Por definir' : `${Math.max(0, days)} días`} /><Metric icon={<MapPin />} label="Destinos" value={`${destinations.data.length}`} /><Metric icon={<WalletCards />} label="Pagado" value={money(spent)} /><Metric icon={<CheckCircle2 />} label="Checklist" value={`${completed}/${checklist.data.length}`} /></section><div className="trip-dashboard"><section><h2>Qué sigue</h2>{itinerary.data.sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ? <p>{itinerary.data[0].title} · {format(parseISO(itinerary.data[0].starts_at), 'dd MMM HH:mm')}</p> : <EmptyState title="Sin itinerario" description="Añade la primera actividad." />}</section><section><h2>Presupuesto</h2><strong>{money(spent)} de {money(Number(trip.budget_total))}</strong><ProgressBar value={Number(trip.budget_total) ? spent / Number(trip.budget_total) * 100 : 0} /></section></div></>}
    {tab !== 'dashboard' && <section className="growth-section"><header><div><span className="eyebrow">{trip.name}</span><h2>{({ destinations: 'Destinos', budget: 'Presupuesto', itinerary: 'Itinerario', reservations: 'Reservas', checklist: 'Checklist' })[tab]}</h2></div><Button icon={<Plus size={14} />} onClick={() => setDialog(tab)}>Añadir</Button></header><TravelRows tab={tab} data={{ destinations: destinations.data, budget: budget.data, itinerary: itinerary.data, reservations: reservations.data, checklist: checklist.data }[tab]} onToggle={async (id, value) => { if (!checklist.user) return; await travelChecklistRepository.update(id, { completed: value }, checklist.user.id); await checklist.refresh() }} /></section>}
    {dialog && <TravelItemDialog tab={dialog} tripId={trip.id} userId={destinations.user?.id} onClose={() => setDialog(undefined)} onSaved={async () => { setDialog(undefined); await refreshAll(); setFeedback('Elemento guardado.') }} />}
  </div>
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) { return <article>{icon}<span>{label}</span><strong>{value}</strong></article> }
function TravelRows({ tab, data, onToggle }: { tab: Exclude<Tab, 'dashboard'>; data: Array<Record<string, unknown>>; onToggle: (id: string, value: boolean) => void }) {
  if (!data.length) return <EmptyState title="Aún no hay elementos" description="Añade el primero para construir esta parte del viaje." />
  return <div className="growth-list">{data.map((item) => <article key={String(item.id)}>{tab === 'checklist' && <button aria-label="Cambiar estado" onClick={() => onToggle(String(item.id), !item.completed)}>{item.completed ? <CheckCircle2 /> : <Circle />}</button>}<div><strong>{String(item.title ?? item.city ?? item.description ?? item.provider ?? 'Elemento')}</strong><small>{String(item.country ?? item.category ?? item.type ?? item.section ?? '')}</small></div><span>{item.starts_at ? format(parseISO(String(item.starts_at)), 'dd MMM HH:mm') : item.amount != null ? money(Number(item.amount)) : item.budgeted != null ? money(Number(item.budgeted)) : ''}</span></article>)}</div>
}

function TravelItemDialog({ tab, tripId, userId, onClose, onSaved }: { tab: Exclude<Tab, 'dashboard'>; tripId: string; userId?: string; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(''), [secondary, setSecondary] = useState(''), [amount, setAmount] = useState('0'), [date, setDate] = useState(new Date().toISOString().slice(0, 16))
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!userId) return
    if (tab === 'destinations') await travelDestinationRepository.save({ user_id: userId, trip_id: tripId, city: title, country: secondary || 'Por definir' }, userId)
    if (tab === 'budget') await travelBudgetRepository.save({ user_id: userId, trip_id: tripId, description: title, category: 'other', budgeted: Number(amount) }, userId)
    if (tab === 'itinerary') await travelItineraryRepository.save({ user_id: userId, trip_id: tripId, title, type: 'activity', starts_at: new Date(date).toISOString(), cost: Number(amount) }, userId)
    if (tab === 'reservations') await travelReservationRepository.save({ user_id: userId, trip_id: tripId, provider: title, type: 'other', amount: Number(amount) }, userId)
    if (tab === 'checklist') await travelChecklistRepository.save({ user_id: userId, trip_id: tripId, title, section: 'pending' }, userId)
    onSaved()
  }
  return <Modal open title="Añadir elemento" onClose={onClose}><form className="growth-form" onSubmit={submit}><label>{tab === 'destinations' ? 'Ciudad' : tab === 'reservations' ? 'Proveedor' : tab === 'budget' ? 'Concepto' : 'Título'}<input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} /></label>{tab === 'destinations' && <label>País<input value={secondary} onChange={(event) => setSecondary(event.target.value)} /></label>}{tab === 'itinerary' && <label>Fecha y hora<input type="datetime-local" required value={date} onChange={(event) => setDate(event.target.value)} /></label>}{['budget', 'itinerary', 'reservations'].includes(tab) && <label>Monto<input type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>}<div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar</Button></div></form></Modal>
}
