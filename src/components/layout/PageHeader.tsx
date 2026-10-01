import orbUrl from '../../assets/faro-orb-v1.png'
import { FaroVoicePresence } from '../../features/voice/FaroVoicePresence'
import type { ReactNode } from 'react'

interface PageHeaderProps {
  eyebrow?: string
  title: string
  description?: string
  showDescription?: boolean
  onCapture?: () => void
  voiceSurface?: 'dashboard' | 'today' | 'finances'
  showVoice?: boolean
  trailing?: ReactNode
}

export function PageHeader({ eyebrow, title, description, showDescription = false, voiceSurface = 'dashboard', showVoice = false, trailing }: PageHeaderProps) {
  return (
    <header className={`page-header page-header--faro ${showVoice ? '' : 'page-header--orb-only'}${trailing ? ' page-header--with-trailing' : ''}`}>
      <div className="page-header__copy">
        <div className="page-header__title-block">
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
          {showDescription && description && <p>{description}</p>}
        </div>
        {trailing && <div className="page-header__trailing">{trailing}</div>}
      </div>
      <div className="page-header__orb" aria-hidden="true"><span /><img src={orbUrl} alt="" /></div>
      {showVoice && <FaroVoicePresence surface={voiceSurface} />}
    </header>
  )
}
