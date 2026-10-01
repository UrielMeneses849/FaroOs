import { CheckCircle2, CircleDot } from 'lucide-react'
import type { Workspace } from '../../types'

export interface WorkspaceMetrics { active: number; pending: number }

export function WorkspaceOverviewGrid({ workspaces, activeId, metrics, onSelect }: { workspaces: Workspace[]; activeId: string; metrics: Record<string, WorkspaceMetrics>; onSelect: (id: string) => void }) {
  const values = Object.values(metrics)
  const total = values.reduce<WorkspaceMetrics>((result, item) => ({ active: result.active + item.active, pending: result.pending + item.pending }), { active: 0, pending: 0 })
  return <section className="workspace-overview-grid" aria-label="Workspaces"><WorkspaceOverviewCard id="all" name="Todos" active={activeId === 'all'} metrics={total} onSelect={onSelect} />{workspaces.map((workspace) => <WorkspaceOverviewCard key={workspace.id} id={workspace.id} name={workspace.name} active={activeId === workspace.id} metrics={metrics[workspace.id] ?? { active: 0, pending: 0 }} onSelect={onSelect} />)}</section>
}

export function WorkspaceOverviewCard({ id, name, active, metrics, onSelect }: { id: string; name: string; active: boolean; metrics: WorkspaceMetrics; onSelect: (id: string) => void }) {
  const tone = name.toLowerCase().replace(/\s+/g, '-')
  return <button className={`workspace-overview-card workspace-overview-card--${tone} ${active ? 'active' : ''}`} onClick={() => onSelect(id)} aria-pressed={active}><div className="workspace-overview-card__copy"><span>{active ? <CheckCircle2 size={13} /> : <CircleDot size={13} />}{name}</span><div><small><b>{metrics.active}</b> activos</small><small><b>{metrics.pending}</b> pendientes</small></div></div></button>
}
