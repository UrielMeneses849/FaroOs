import type { EntityStatus, IdeaStatus, LifeArea, TaskStatus } from '../../types'

const areaNames: Record<LifeArea, string> = { personal: 'Personal', health: 'Salud', finance: 'Finanzas', learning: 'Aprendizaje', nexvora: 'Nexvora', portfolio: 'Portafolio', travel: 'Viajes', relationships: 'Relaciones' }
const statusNames: Record<EntityStatus | TaskStatus | IdeaStatus, string> = { idea: 'Idea', planned: 'Planeado', active: 'Activo', paused: 'En pausa', blocked: 'Bloqueado', completed: 'Completado', inbox: 'Inbox', todo: 'Por hacer', doing: 'En curso', done: 'Listo', archived: 'Archivado', converted: 'Convertido' }

export function AreaBadge({ area }: { area: LifeArea }) {
  return <span className="area-badge" data-area={area}>{areaNames[area]}</span>
}

export function StatusBadge({ status }: { status: EntityStatus | TaskStatus | IdeaStatus }) {
  return <span className="status-badge" data-status={status}>{statusNames[status]}</span>
}
