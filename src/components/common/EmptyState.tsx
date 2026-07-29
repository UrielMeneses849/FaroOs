import { Compass } from 'lucide-react'
import type { ReactNode } from 'react'

interface EmptyStateProps { title: string; description: string; action?: ReactNode }

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon"><Compass aria-hidden="true" /></div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  )
}
