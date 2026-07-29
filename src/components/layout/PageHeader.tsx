import { Bell, Plus } from 'lucide-react'
import { Button, IconButton } from '../common'

interface PageHeaderProps { eyebrow?: string; title: string; description?: string; onCapture: () => void }

export function PageHeader({ eyebrow, title, description, onCapture }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__copy">{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>
      <div className="page-header__actions">
        <IconButton label="Notificaciones"><Bell size={19} /></IconButton>
        <Button icon={<Plus size={17} />} onClick={onCapture}>Capturar</Button>
      </div>
    </header>
  )
}
