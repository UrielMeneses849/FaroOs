import { Modal } from '../../components/common'
import { getFaroNavigationAdapter, type FaroNavigationAdapter } from '../../core/platform/runtime'
import { AiLabConsole } from './AiLabConsole'
import type { FaroVoiceSnapshot, FaroVoiceSurface } from './faroVoiceConfig'

export type VoicePresentation = 'modal' | 'mini'

export function VoicePanel({ open, presentation, surface, autoStartToken, activateOnStart, onClose, onSnapshotChange }: { open: boolean; presentation: VoicePresentation; surface: FaroVoiceSurface; autoStartToken: number; activateOnStart: boolean; onClose: () => void; onSnapshotChange: (snapshot: FaroVoiceSnapshot) => void }) {
  const navigation: FaroNavigationAdapter = getFaroNavigationAdapter() ?? { navigate: (path) => globalThis.location.assign(`${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`) }
  if (!open) return null
  const voiceConsole = <AiLabConsole mode="product" surface={surface} autoStartToken={autoStartToken} activateOnStart={activateOnStart} onOpenFinance={() => navigation.navigate('/finance')} onSnapshotChange={onSnapshotChange} />
  if (presentation === 'mini') return <div className="voice-background-session" aria-hidden="true">{voiceConsole}</div>
  return <Modal panelClassName="voice-modal voice-modal--production" open={open} title="Hablar con FARO" onClose={onClose}>
    {voiceConsole}
  </Modal>
}
