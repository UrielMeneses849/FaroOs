import { CalendarPlus, ChevronRight, ListPlus, ReceiptText } from 'lucide-react'
import { Modal } from '../common'

export function MobileQuickActions({ open, onClose, onExpense, onCalendar, onCapture }: {
  open: boolean
  onClose: () => void
  onExpense: () => void
  onCalendar: () => void
  onCapture: () => void
}) {
  return <Modal open={open} title="Nuevo en FARO" onClose={onClose} panelClassName="mobile-quick-actions">
    <p className="mobile-quick-actions__intro">Registra lo importante sin recorrer toda la aplicación.</p>
    <div className="mobile-quick-actions__list">
      <button type="button" onClick={onExpense}>
        <span className="mobile-quick-actions__icon"><ReceiptText size={21} /></span>
        <span><strong>Gasto rápido</strong><small>Monto, descripción y cuenta</small></span>
        <ChevronRight size={18} />
      </button>
      <button type="button" onClick={onCalendar}>
        <span className="mobile-quick-actions__icon"><CalendarPlus size={21} /></span>
        <span><strong>Nuevo evento</strong><small>Fecha, hora y duración</small></span>
        <ChevronRight size={18} />
      </button>
      <button type="button" onClick={onCapture}>
        <span className="mobile-quick-actions__icon"><ListPlus size={21} /></span>
        <span><strong>Idea o tarea</strong><small>Envíala directo al Backlog</small></span>
        <ChevronRight size={18} />
      </button>
    </div>
  </Modal>
}
