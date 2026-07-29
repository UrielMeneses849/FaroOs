import { Check, ChevronDown } from 'lucide-react'
import { useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
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
  const auth = useContext(AuthContext), id = useId(), root = useRef<HTMLDivElement>(null)
  const open = useSyncExternalStore(subscribe, getSnapshot, getSnapshot) === id
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setActiveMenu(null) }
    const closeKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setActiveMenu(null) }
    const closeScroll = () => setActiveMenu(null)
    document.addEventListener('pointerdown', closeOutside); document.addEventListener('keydown', closeKey); window.addEventListener('scroll', closeScroll, true)
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeKey); window.removeEventListener('scroll', closeScroll, true) }
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
  return <div ref={root} className="status-selector"><button type="button" className={`status-selector__trigger status-selector--${normalized}`} aria-haspopup="menu" aria-expanded={open} disabled={disabled || saving} onClick={() => setActiveMenu(open ? null : id)}><i />{taskStatusLabel(value)}<ChevronDown size={12} /></button>{open && <div role="menu">{options.map(([status, label]) => <button type="button" role="menuitem" key={status} onClick={() => void select(status)}><i className={`status-dot status-dot--${status}`} />{label}{status === normalized && <Check size={12} />}</button>)}</div>}{error && <span className="status-selector__error" role="alert">{error}</span>}</div>
}
