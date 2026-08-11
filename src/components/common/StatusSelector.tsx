import { Check, ChevronDown } from 'lucide-react'
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { AuthContext } from '../../providers/AuthContext'
import { taskRepository } from '../../repositories/taskRepository'
import type { Task, TaskStatus } from '../../types'

const options: Array<[TaskStatus, string]> = [['todo', 'Por hacer'], ['doing', 'En progreso'], ['blocked', 'Bloqueada'], ['done', 'Completada']]
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
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setActiveMenu(null)
    }
    const closeKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setActiveMenu(null) }
    document.addEventListener('pointerdown', closeOutside); document.addEventListener('keydown', closeKey)
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeKey) }
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
  const select = async (status: TaskStatus) => {
    const previous = value; setActiveMenu(null); setError(''); onChange(status)
    if (!task || !auth?.user) return
    setSaving(true)
    try { await taskRepository.update({ ...task, status, updatedAt: new Date().toISOString() }, auth.user.id) }
    catch (reason) { onChange(previous); setError(reason instanceof Error ? reason.message : 'No se guardó el estado.') }
    finally { setSaving(false) }
  }
  const normalized = value === 'inbox' || value === 'paused' ? 'todo' : value
  return <div ref={root} className="status-selector"><button ref={trigger} type="button" className={`status-selector__trigger status-selector--${normalized}`} aria-haspopup="menu" aria-expanded={open} disabled={disabled || saving} onClick={() => setActiveMenu(open ? null : id)}><i />{taskStatusLabel(value)}<ChevronDown size={12} /></button>{open && createPortal(<div ref={menu} className="status-selector__menu" role="menu" style={{ top: menuPosition.top, left: menuPosition.left, visibility: menuPosition.visible ? 'visible' : 'hidden' }}>{options.map(([status, label]) => <button type="button" role="menuitem" key={status} onClick={() => void select(status)}><i className={`status-dot status-dot--${status}`} />{label}{status === normalized && <Check size={12} />}</button>)}</div>, document.body)}{error && <span className="status-selector__error" role="alert">{error}</span>}</div>
}
