import orbUrl from '../../assets/faro-orb-v1.png'
import { FaroVoicePresence } from '../../features/voice/FaroVoicePresence'

interface PageHeaderProps {
  eyebrow?: string
  title: string
  description?: string
  onCapture?: () => void
  voiceSurface?: 'dashboard' | 'today' | 'finances'
}

export function PageHeader({ eyebrow, title, description, voiceSurface = 'dashboard' }: PageHeaderProps) {
  return (
    <header className="page-header page-header--faro">
      <div className="page-header__copy">{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>
      <div className="page-header__orb" aria-hidden="true"><span /><img src={orbUrl} alt="" /></div>
      <FaroVoicePresence surface={voiceSurface} />
    </header>
  )
}
