import { X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/utils'
import { IconButton } from './IconButton'

interface ModalProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  panelClassName?: string
}

// One lock and one active keyboard owner, regardless of JSX order or close order.
const modalStack: HTMLDivElement[] = []
let bodyOverflow = ''
let modalLayer = 80
const updateModalStack = () => {
  modalStack.forEach((element, index) => { element.inert = index !== modalStack.length - 1 })
}

export function Modal({ open, title, onClose, children, panelClassName }: ModalProps) {
  const titleId = useId()
  const backdropRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const viewport = window.visualViewport
    const backdrop = backdropRef.current
    const panel = panelRef.current
    if (!open || !viewport || !backdrop || !panel) return
    const previous = { top: backdrop.style.top, bottom: backdrop.style.bottom, height: backdrop.style.height, maxHeight: panel.style.maxHeight }
    let frame: number | undefined
    const fitViewport = () => {
      frame = undefined
      if (!Number.isFinite(viewport.height) || viewport.height <= 0) return
      backdrop.style.top = `${Math.max(0, viewport.offsetTop)}px`
      backdrop.style.bottom = 'auto'
      backdrop.style.height = `${viewport.height}px`
      panel.style.maxHeight = '100%'
    }
    const scheduleFit = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(fitViewport)
    }
    // On-screen keyboards can shrink/pan the visual viewport without changing
    // 100dvh. Keep the existing flex body scroll inside the space still visible.
    fitViewport()
    viewport.addEventListener('resize', scheduleFit, { passive: true })
    viewport.addEventListener('scroll', scheduleFit, { passive: true })
    return () => {
      viewport.removeEventListener('resize', scheduleFit)
      viewport.removeEventListener('scroll', scheduleFit)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      backdrop.style.top = previous.top
      backdrop.style.bottom = previous.bottom
      backdrop.style.height = previous.height
      panel.style.maxHeight = previous.maxHeight
    }
  }, [open])

  useEffect(() => {
    if (!open || !backdropRef.current) return
    const backdrop = backdropRef.current
    if (!modalStack.length) {
      bodyOverflow = document.body.style.overflow
      modalLayer = 80
    }
    backdrop.style.zIndex = String(++modalLayer)
    modalStack.push(backdrop)
    updateModalStack()
    document.body.style.overflow = 'hidden'
    const previous = document.activeElement as HTMLElement | null
    const initialFocus = panelRef.current?.querySelector<HTMLElement>('input, select, textarea')
    if (initialFocus) initialFocus.focus()
    else panelRef.current?.focus()
    const handleKeys = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== backdrop) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) {
        event.preventDefault()
        panelRef.current.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeys)
    return () => {
      document.removeEventListener('keydown', handleKeys)
      const wasTop = modalStack.at(-1) === backdrop
      const index = modalStack.indexOf(backdrop)
      if (index >= 0) modalStack.splice(index, 1)
      backdrop.inert = true
      updateModalStack()
      if (!modalStack.length) document.body.style.overflow = bodyOverflow
      if (wasTop && previous?.isConnected && !previous.closest('[inert]')) previous.focus()
      else if (wasTop) modalStack.at(-1)?.querySelector<HTMLElement>('[role="dialog"]')?.focus()
    }
  }, [open])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div ref={backdropRef} className="modal-backdrop" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && modalStack.at(-1) === backdropRef.current && onClose()}>
          <motion.div ref={panelRef} className={cn('modal-panel', panelClassName)} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} initial={reduceMotion ? false : { opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }}>
            <div className="modal-header">
              <h2 id={titleId}>{title}</h2>
              <IconButton label="Cerrar modal" onClick={onClose}><X size={18} /></IconButton>
            </div>
            <div className="modal-body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>, document.body
  )
}
