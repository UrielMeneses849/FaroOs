import { Modal } from '../../components/common'
import { AiLabConsole } from './AiLabConsole'
import type { FaroVoiceSurface, FaroVoiceVisualState } from './faroVoiceConfig'

export function VoicePanel({ open, surface, onClose, onStateChange }: { open: boolean; surface: FaroVoiceSurface; onClose: () => void; onStateChange: (state: FaroVoiceVisualState) => void }) {
  return <Modal panelClassName="voice-modal voice-modal--production" open={open} title="Hablar con FARO" onClose={onClose}>
    <AiLabConsole mode="product" surface={surface} onOpenFinance={() => window.location.assign(`${import.meta.env.BASE_URL}finance`)} onStateChange={onStateChange} />
  </Modal>
}
