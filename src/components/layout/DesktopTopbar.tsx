import { ArrowUpRight, CalendarPlus, CircleDollarSign, Plus, Search, Sun, Target } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { allNavigationItems, settingsItem } from '../../app/navigation'
import { isFaroDesktop } from '../../desktop/desktopBridge'
import { useAuth } from '../../hooks/auth'
import { useFaroStore } from '../../store/useFaroStore'
import { Modal } from '../common'

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')

export function DesktopTopbar({ onCapture }: { onCapture: () => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { user } = useAuth()
  const goals = useFaroStore((state) => state.goals)
  const navigate = useNavigate()
  const desktop = isFaroDesktop()
  const name = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || 'FARO'
  const initial = String(name).trim().charAt(0).toLocaleUpperCase('es') || 'F'
  const applications = [
    ...allNavigationItems.filter((item) => !item.desktopOnly || desktop).map((item) => ({ ...item, label: item.id === 'dashboard' ? 'Inicio' : item.id === 'backlog' ? 'Pendientes' : item.label })),
    { id: 'today', label: 'Hoy', icon: Sun, route: '/today' },
    { id: 'goals', label: 'Objetivos', icon: Target, route: '/goals' },
    settingsItem,
  ].filter((item) => normalize(item.label).includes(normalize(query.trim())))
  const matchingGoals = query.trim() ? goals.filter((goal) => !goal.archivedAt && normalize(goal.title).includes(normalize(query.trim()))).slice(0, 8) : []
  const actions = [
    { label: 'Captura rápida', icon: Plus, run: onCapture },
    { label: 'Registrar movimiento', icon: CircleDollarSign, run: () => navigate('/finance?quick=movement') },
    { label: 'Nuevo evento', icon: CalendarPlus, run: () => navigate('/calendar?quick=event') },
  ].filter((item) => normalize(item.label).includes(normalize(query.trim())))
  const close = () => { setOpen(false); setQuery('') }
  const go = (route: string) => { close(); navigate(route) }

  return <>
    <header className="paper-topbar" aria-label="Herramientas de FARO">
      <button type="button" className="paper-search-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog"><Search size={18} aria-hidden="true" /><span>Buscar en FARO…</span></button>
      <div className="paper-topbar__actions"><button type="button" className="paper-capture" aria-label="Captura rápida" onClick={onCapture}><Plus size={17} aria-hidden="true" /><span>Captura rápida</span></button><Link className="paper-avatar" to="/settings" aria-label="Abrir ajustes">{initial}</Link></div>
    </header>
    <Modal open={open} title="Buscar en FARO" onClose={close} panelClassName="paper-search-modal">
      <label className="paper-search-field"><Search size={20} aria-hidden="true" /><input aria-label="Buscar aplicaciones, objetivos y acciones" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Aplicación, objetivo o acción…" autoComplete="off" /></label>
      <p className="paper-search-hint">Busca aplicaciones, objetivos y acciones rápidas.</p>
      <div className="paper-search-results">
        {applications.length > 0 && <section aria-label="Aplicaciones"><h3>Aplicaciones</h3><div>{applications.map((item) => <button type="button" key={item.id} onClick={() => go(item.route)}><item.icon size={18} aria-hidden="true" /><span>{item.label}</span><ArrowUpRight size={15} aria-hidden="true" /></button>)}</div></section>}
        {matchingGoals.length > 0 && <section aria-label="Objetivos encontrados"><h3>Objetivos</h3>{matchingGoals.map((goal) => <button type="button" key={goal.id} onClick={() => go(`/goals/${goal.id}`)}><Target size={18} aria-hidden="true" /><span>{goal.title}</span><ArrowUpRight size={15} aria-hidden="true" /></button>)}</section>}
        {actions.length > 0 && <section aria-label="Acciones rápidas"><h3>Acciones rápidas</h3>{actions.map((action) => <button type="button" key={action.label} onClick={() => { close(); action.run() }}><action.icon size={18} aria-hidden="true" /><span>{action.label}</span><ArrowUpRight size={15} aria-hidden="true" /></button>)}</section>}
        {!applications.length && !matchingGoals.length && !actions.length && <p className="paper-search-empty" role="status">Sin resultados. Prueba con el nombre de una aplicación, un objetivo o una acción.</p>}
      </div>
    </Modal>
  </>
}
