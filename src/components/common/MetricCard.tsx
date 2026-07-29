import type { LucideIcon } from 'lucide-react'

interface MetricCardProps { label: string; value: string | number; detail?: string; icon: LucideIcon }

export function MetricCard({ label, value, detail, icon: Icon }: MetricCardProps) {
  return <article className="metric-card"><div className="metric-card__top"><span>{label}</span><Icon size={17} aria-hidden="true" /></div><strong>{value}</strong>{detail && <small>{detail}</small>}</article>
}
