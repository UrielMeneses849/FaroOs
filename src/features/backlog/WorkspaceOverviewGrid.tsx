import { CheckCircle2, CircleDot, FolderKanban, Target } from 'lucide-react'
import type { Workspace } from '../../types'

export interface WorkspaceMetrics { pending: number; tasks: number; projects: number; goals: number }

const descriptions: Record<string, string> = {
  bbva: 'Datos, estrategia financiera y ejecución profesional.',
  bimsa: 'Investigación, territorio y proyectos de construcción.',
  nexvora: 'Producto digital, inteligencia artificial y crecimiento.',
  portfolio: 'Diseño, código y narrativa creativa.',
  personal: 'Vida personal y asuntos fuera de otros contextos.',
}

export function WorkspaceOverviewGrid({ workspaces, activeId, metrics, onSelect }: { workspaces: Workspace[]; activeId: string; metrics: Record<string, WorkspaceMetrics>; onSelect: (id: string) => void }) {
  const values = Object.values(metrics)
  const total = values.reduce<WorkspaceMetrics>((result, item) => ({ pending: result.pending + item.pending, tasks: result.tasks + item.tasks, projects: result.projects + item.projects, goals: result.goals + item.goals }), { pending: 0, tasks: 0, projects: 0, goals: 0 })
  return <section className="workspace-overview-grid" aria-label="Workspaces"><WorkspaceOverviewCard id="all" name="Todos" description="Una vista completa de todos tus contextos." active={activeId === 'all'} metrics={total} onSelect={onSelect} />{workspaces.map((workspace) => <WorkspaceOverviewCard key={workspace.id} id={workspace.id} name={workspace.name} description={descriptions[workspace.name.toLowerCase()] ?? 'Un contexto enfocado dentro de FARO OS.'} active={activeId === workspace.id} metrics={metrics[workspace.id] ?? { pending: 0, tasks: 0, projects: 0, goals: 0 }} onSelect={onSelect} />)}</section>
}

export function WorkspaceOverviewCard({ id, name, description, active, metrics, onSelect }: { id: string; name: string; description: string; active: boolean; metrics: WorkspaceMetrics; onSelect: (id: string) => void }) {
  const tone = name.toLowerCase().replace(/\s+/g, '-')
  return <button className={`workspace-overview-card workspace-overview-card--${tone} ${active ? 'active' : ''}`} onClick={() => onSelect(id)} aria-pressed={active}><div className="workspace-overview-card__copy"><span>{active ? <CheckCircle2 size={13} /> : <CircleDot size={13} />}{name}</span><p>{description}</p><div><small>{metrics.pending} pendientes</small><small><FolderKanban size={11} />{metrics.projects}</small><small><Target size={11} />{metrics.goals}</small></div></div></button>
}
