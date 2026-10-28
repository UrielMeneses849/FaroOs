import { Check, ChevronDown } from 'lucide-react'
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { AuthContext } from '../../providers/AuthContext'
import { taskRepository } from '../../repositories/taskRepository'
import type { Task, TaskStatus } from '../../types'

const options: Array<[TaskStatus, string]> = [['todo', 'Por hacer'], ['doing', 'En progreso'], ['waiting', 'En espera'], ['blocked', 'En revisión'], ['done', 'Completada']]
const taskStatusLabel = (status: TaskStatus) => options.find(([value]) => value === status)?.[1] ?? (status === 'inbox' || status === 'paused' ? 'Por hacer' : status)
let activeMenu: string | null = null
const subscribers = new Set<() => void>()
const setActiveMenu = (id: string | null) => { activeMenu = id; subscribers.forEach((notify) => notify()) }
const subscribe = (notify: () => void) => { subscribers.add(notify); return () => { subscribers.delete(notify) } }
const getSnapshot = () => activeMenu

export function StatusSelector({ value, task, onChange, disabled = false }: { value: TaskStatus; task?: Task; onChange: (status: TaskStatus) => void; disabled?: boolean }) {
  const auth = useContext(AuthContext), id = useId(), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null)
  const open = useSyncExternalStore(subscribe, getSnapshot, getSnapshot) === id
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, visible: false })
  const openingFocus = useRef<'first' | 'last' | null>(null)
  const normalized = value === 'inbox' || value === 'paused' ? 'todo' : value
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setActiveMenu(null)
    }
    const closeKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setActiveMenu(null)
      trigger.current?.focus()
    }
    // Own Escape before a surrounding Modal's document-level handler. Closing
    // the task-state menu must not also dismiss the form beneath it.
    document.addEventListener('pointerdown', closeOutside); document.addEventListener('keydown', closeKey, true)
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeKey, true) }
  }, [open])
  useLayoutEffect(() => {
    if (!open) return
    let frame = 0
    const position = () => {
      const bounds = trigger.current?.getBoundingClientRect()
      if (!bounds) return
      const menuWidth = menu.current?.offsetWidth || 145
      const menuHeight = menu.current?.offsetHeight || 134
      const padding = 8
      const left = Math.min(Math.max(padding, bounds.left), window.innerWidth - menuWidth - padding)
      const below = bounds.bottom + 5
      const top = below + menuHeight <= window.innerHeight - padding
        ? below
        : Math.max(padding, bounds.top - menuHeight - 5)
      setMenuPosition({ top, left, visible: true })
    }
    const schedulePosition = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(position)
    }
    position()
    window.addEventListener('resize', schedulePosition)
    window.addEventListener('scroll', schedulePosition, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedulePosition)
      window.removeEventListener('scroll', schedulePosition, true)
      setMenuPosition((current) => ({ ...current, visible: false }))
    }
  }, [open])
  useEffect(() => {
    if (!open || !menuPosition.visible) return
    const items = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    if (!items?.length) return
    const index = openingFocus.current === 'first' ? 0 : openingFocus.current === 'last' ? items.length - 1 : options.findIndex(([status]) => status === normalized)
    items[Math.max(0, index)]?.focus()
    openingFocus.current = null
  }, [open, menuPosition.visible, normalized])
  const select = async (status: TaskStatus) => {
    const previous = value; setActiveMenu(null); setError(''); onChange(status)
    trigger.current?.focus()
    if (!task || !auth?.user) return
    setSaving(true)
    try { await taskRepository.updateStatus(task.id, status, auth.user.id, task.sortOrder) }
    catch (reason) {
      onChange(previous)
      const detail = reason && typeof reason === 'object' && 'message' in reason ? String(reason.message) : ''
      setError(detail || 'No se guardó el estado.')
    }
    finally { setSaving(false) }
  }
  return <div ref={root} className="status-selector"><button ref={trigger} type="button" className={`status-selector__trigger status-selector--${normalized}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined} disabled={disabled || saving} onKeyDown={(event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    openingFocus.current = event.key === 'ArrowDown' ? 'first' : 'last'
    setActiveMenu(id)
  }} onClick={() => setActiveMenu(open ? null : id)}><i />{taskStatusLabel(value)}<ChevronDown size={12} /></button>{open && createPortal(<div ref={menu} id={`${id}-menu`} className="status-selector__menu" role="menu" aria-label="Cambiar estado de la tarea" style={{ top: menuPosition.top, left: menuPosition.left, visibility: menuPosition.visible ? 'visible' : 'hidden' }} onKeyDown={(event) => {
    if (event.key === 'Tab') {
      const dialog = trigger.current?.closest('[role="dialog"]')
      const scope = dialog ?? document
      const controls = [...scope.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]')].filter((element) => {
        if (element.tabIndex < 0 || element.closest('[inert], [hidden]')) return false
        for (let node: HTMLElement | null = element; node; node = node.parentElement) {
          const style = getComputedStyle(node)
          if (style.display === 'none' || style.visibility === 'hidden') return false
        }
        return true
      })
      const index = controls.indexOf(trigger.current!)
      const nextIndex = index + (event.shiftKey ? -1 : 1)
      const next = controls[nextIndex] ?? (dialog ? controls[(nextIndex + controls.length) % controls.length] : undefined)
      setActiveMenu(null)
      if (next) {
        event.preventDefault()
        event.stopPropagation()
        next.focus()
      } else trigger.current?.focus()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }}>{options.map(([status, label]) => <button type="button" role="menuitem" tabIndex={-1} key={status} onClick={() => void select(status)}><i className={`status-dot status-dot--${status}`} />{label}{status === normalized && <Check size={12} />}</button>)}</div>, document.body)}{error && <span className="status-selector__error" role="alert">{error}</span>}</div>
}
