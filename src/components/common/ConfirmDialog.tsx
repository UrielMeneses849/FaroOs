import { Button } from './Button'
import { Modal } from './Modal'

interface ConfirmDialogProps { open: boolean; title: string; description: string; confirmLabel?: string; onConfirm: () => void; onClose: () => void }

export function ConfirmDialog({ open, title, description, confirmLabel = 'Confirmar', onConfirm, onClose }: ConfirmDialogProps) {
  return <Modal open={open} title={title} onClose={onClose}><p className="modal-description">{description}</p><div className="modal-actions"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button></div></Modal>
}
