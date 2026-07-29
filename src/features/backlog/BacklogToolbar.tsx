import { Filter, Search, X } from 'lucide-react'
import type { LifeArea, Priority } from '../../types'
import type { BacklogFilterState } from './backlogTypes'

const areas: Array<[LifeArea | 'all', string]> = [['all', 'Todas las áreas'], ['personal', 'Personal'], ['health', 'Salud'], ['finance', 'Finanzas'], ['learning', 'Aprendizaje'], ['nexvora', 'Nexvora'], ['portfolio', 'Portafolio'], ['travel', 'Viajes'], ['relationships', 'Relaciones']]

export function BacklogToolbar({ filters, onChange, mobileOpen, onMobileToggle }: { filters: BacklogFilterState; onChange: (filters: BacklogFilterState) => void; mobileOpen: boolean; onMobileToggle: () => void }) {
  const set = <K extends keyof BacklogFilterState>(key: K, value: BacklogFilterState[K]) => onChange({ ...filters, [key]: value })
  return (
    <div className="backlog-toolbar">
      <label className="backlog-search"><Search size={16} /><span className="sr-only">Buscar en backlog</span><input value={filters.query} onChange={(event) => set('query', event.target.value)} placeholder="Buscar por título o descripción…" />{filters.query && <button aria-label="Limpiar búsqueda" onClick={() => set('query', '')}><X size={14} /></button>}</label>
      <button className="mobile-filter-toggle" onClick={onMobileToggle}><Filter size={16} /> Filtros</button>
      <div className={`backlog-filters ${mobileOpen ? 'open' : ''}`}>
        <label>Área<select value={filters.area} onChange={(event) => set('area', event.target.value as LifeArea | 'all')}>{areas.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>Prioridad<select value={filters.priority} onChange={(event) => set('priority', event.target.value as Priority | 'all')}><option value="all">Todas</option><option value="high">Alta</option><option value="medium">Media</option><option value="low">Baja</option></select></label>
        <label>Estado<select value={filters.status} onChange={(event) => set('status', event.target.value)}><option value="all">Todos</option><option value="inbox">Inbox</option><option value="idea">Idea</option><option value="todo">Por hacer</option><option value="doing">En curso</option><option value="done">Listo</option><option value="planned">Planeado</option><option value="active">Activo</option><option value="paused">En pausa</option></select></label>
        <label>Orden<select value={filters.sort} onChange={(event) => set('sort', event.target.value as BacklogFilterState['sort'])}><option value="created">Más reciente</option><option value="priority">Prioridad</option><option value="due">Vencimiento</option></select></label>
      </div>
    </div>
  )
}
