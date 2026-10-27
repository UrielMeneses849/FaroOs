import { FolderKanban, Plus } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { BacklogSection, Task } from '../../types'

export function BacklogOrganizer({ tasks, sections, workspaceName, sectionFilter, onSectionFilter, onManageSections }: {
  tasks: Task[]
  sections: BacklogSection[]
  workspaceName: string
  sectionFilter: string
  onSectionFilter: (value: string) => void
  onManageSections: () => void
}) {
  const activeTasks = tasks.filter((task) => !task.archivedAt)
  const progressFor = (sectionId?: string) => {
    const scoped = activeTasks.filter((task) => sectionId === 'unassigned' ? !task.sectionId : task.sectionId === sectionId)
    const done = scoped.filter((task) => task.status === 'done').length
    return { total: scoped.length, done, percent: scoped.length ? Math.round(done / scoped.length * 100) : 0 }
  }
  const unassigned = progressFor('unassigned')
  const sectionProgress = sections.map((section, index) => ({ section, index, progress: progressFor(section.id) }))
    .sort((left, right) => Number(left.progress.total === 0) - Number(right.progress.total === 0) || left.index - right.index)
  const renderSectionCard = ({ section, progress }: (typeof sectionProgress)[number]) => <button key={section.id} className={sectionFilter === section.id ? 'active' : ''} aria-pressed={sectionFilter === section.id} style={{ '--section-color': section.color } as CSSProperties} onClick={() => onSectionFilter(sectionFilter === section.id ? 'all' : section.id)}>
    <span><i /><strong>{section.name}</strong><small>{progress.done}/{progress.total}</small></span>
    <span className="backlog-section-progress__bar"><i style={{ width: `${progress.percent}%` }} /></span>
    <em>{progress.percent}% completado</em>
  </button>

  return <section className="backlog-organizer" aria-label={`Organización del backlog de ${workspaceName}`}>
    <div className="backlog-organizer__header">
      <div><strong>Avance por sección</strong><span>Selecciona una card para filtrar el tablero.</span></div>
      <button className="backlog-organizer__manage" onClick={onManageSections}><Plus size={15} />Nueva sección</button>
    </div>
    <div className="backlog-section-progress" aria-label="Avance por sección">
      {sectionProgress.filter(({ progress }) => progress.total > 0).map(renderSectionCard)}
      {unassigned.total > 0 && <button className={sectionFilter === 'unassigned' ? 'active' : ''} aria-pressed={sectionFilter === 'unassigned'} style={{ '--section-color': '#6f7783' } as CSSProperties} onClick={() => onSectionFilter(sectionFilter === 'unassigned' ? 'all' : 'unassigned')}>
        <span><FolderKanban size={13} /><strong>Sin sección</strong><small>{unassigned.done}/{unassigned.total}</small></span>
        <span className="backlog-section-progress__bar"><i style={{ width: `${unassigned.percent}%` }} /></span>
        <em>Por clasificar</em>
      </button>}
      {sectionProgress.filter(({ progress }) => progress.total === 0).map(renderSectionCard)}
      {!sections.length && !unassigned.total && <p>No hay tareas en este workspace.</p>}
    </div>
  </section>
}
