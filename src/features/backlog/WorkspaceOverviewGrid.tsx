import { CheckCircle2, CircleDot, FolderKanban, Target } from 'lucide-react'
import type { Workspace } from '../../types'

export interface WorkspaceMetrics { pending: number; tasks: number; projects: number; goals: number; progress: number }

const descriptions: Record<string, string> = {
  bbva: 'Datos, estrategia financiera y ejecución profesional.',
  bimsa: 'Investigación, territorio y proyectos de construcción.',
  nexvora: 'Producto digital, inteligencia artificial y crecimiento.',
  portfolio: 'Diseño, código y narrativa creativa.',
  personal: 'Vida personal y asuntos fuera de otros contextos.',
}

export function WorkspaceOverviewGrid({ workspaces, activeId, metrics, onSelect }: { workspaces: Workspace[]; activeId: string; metrics: Record<string, WorkspaceMetrics>; onSelect: (id: string) => void }) {
  const values = Object.values(metrics)
  const total = values.reduce<WorkspaceMetrics>((result, item) => ({ pending: result.pending + item.pending, tasks: result.tasks + item.tasks, projects: result.projects + item.projects, goals: result.goals + item.goals, progress: 0 }), { pending: 0, tasks: 0, projects: 0, goals: 0, progress: 0 })
  total.progress = values.length ? Math.round(values.reduce((sum, item) => sum + item.progress, 0) / values.length) : 0
  return <section className="workspace-overview-grid" aria-label="Workspaces"><WorkspaceOverviewCard id="all" name="Todos" description="Una vista completa de todos tus contextos." active={activeId === 'all'} metrics={total} onSelect={onSelect} />{workspaces.map((workspace) => <WorkspaceOverviewCard key={workspace.id} id={workspace.id} name={workspace.name} description={descriptions[workspace.name.toLowerCase()] ?? 'Un contexto enfocado dentro de FARO OS.'} active={activeId === workspace.id} metrics={metrics[workspace.id] ?? { pending: 0, tasks: 0, projects: 0, goals: 0, progress: 0 }} onSelect={onSelect} />)}</section>
}

export function WorkspaceOverviewCard({ id, name, description, active, metrics, onSelect }: { id: string; name: string; description: string; active: boolean; metrics: WorkspaceMetrics; onSelect: (id: string) => void }) {
  const tone = name.toLowerCase().replace(/\s+/g, '-')
  return <button className={`workspace-overview-card workspace-overview-card--${tone} ${active ? 'active' : ''}`} onClick={() => onSelect(id)} aria-pressed={active}><div className="workspace-overview-card__visual" aria-hidden="true"><svg viewBox="0 0 240 90"><defs><pattern id={`grid-${id}`} width="18" height="18" patternUnits="userSpaceOnUse"><path d="M 18 0 L 0 0 0 18" fill="none" stroke="currentColor" strokeWidth=".4" /></pattern></defs><rect width="240" height="90" fill={`url(#grid-${id})`} /><path d="M5 70 C55 5, 105 95, 155 25 S220 55,235 10" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="55" cy="34" r="3" /><circle cx="155" cy="25" r="3" /><path d="M25 78 L80 48 L120 65 L198 18" fill="none" stroke="currentColor" strokeWidth=".7" /></svg></div><div className="workspace-overview-card__copy"><span>{active ? <CheckCircle2 size={13} /> : <CircleDot size={13} />}{name}</span><p>{description}</p><div><small>{metrics.pending} pendientes</small><small><FolderKanban size={11} />{metrics.projects}</small><small><Target size={11} />{metrics.goals}</small></div></div><strong>{metrics.progress}%</strong></button>
}
