import { Archive, CheckSquare, X } from 'lucide-react'
import type { LifeArea } from '../../types'
import { Button } from '../../components/common'

export function BulkActions({ count, onArchive, onArea, onClear }: { count: number; onArchive: () => void; onArea: (area: LifeArea) => void; onClear: () => void }) {
  if (!count) return null
  return <div className="bulk-actions" role="toolbar" aria-label="Acciones masivas"><span><CheckSquare size={16} /> {count} seleccionados</span><label>Cambiar área<select defaultValue="" onChange={(event) => event.target.value && onArea(event.target.value as LifeArea)}><option value="" disabled>Elegir…</option><option value="personal">Personal</option><option value="health">Salud</option><option value="finance">Finanzas</option><option value="learning">Aprendizaje</option><option value="nexvora">Nexvora</option><option value="portfolio">Portafolio</option><option value="travel">Viajes</option><option value="relationships">Relaciones</option></select></label><Button size="sm" variant="secondary" icon={<Archive size={14} />} onClick={onArchive}>Archivar</Button><button className="bulk-clear" aria-label="Limpiar selección" onClick={onClear}><X size={16} /></button></div>
}
