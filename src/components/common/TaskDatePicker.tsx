import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, parseISO, startOfMonth, startOfWeek, subMonths } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export function TaskDatePicker({ value, onChange, label = 'Fecha límite' }: { value?: string; onChange: (value: string) => void; label?: string }) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => value ? parseISO(value) : new Date())
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const calendar = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = calendar.current
    if (!open || !element?.closest('.modal-panel') || typeof element.scrollIntoView !== 'function') return
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape, true) }
  }, [open])
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  })
  return <div className="task-datepicker" ref={root}>
    <span>{label}</span>
    <button ref={trigger} type="button" className="task-datepicker__trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)}><CalendarDays size={14} />{value ? format(parseISO(value), 'd MMMM yyyy', { locale: es }) : 'Sin fecha'}</button>
    {open && <div ref={calendar} className="task-calendar" role="dialog" aria-label="Seleccionar fecha"><header><button type="button" aria-label="Mes anterior" onClick={() => setMonth((current) => subMonths(current, 1))}><ChevronLeft size={15} /></button><strong>{format(month, 'MMMM yyyy', { locale: es })}</strong><button type="button" aria-label="Mes siguiente" onClick={() => setMonth((current) => addMonths(current, 1))}><ChevronRight size={15} /></button></header><div className="task-calendar__week">{['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div><div className="task-calendar__days">{days.map((day) => { const key = format(day, 'yyyy-MM-dd'); return <button type="button" key={key} className={`${isSameMonth(day, month) ? '' : 'outside'} ${value === key ? 'selected' : ''}`} aria-pressed={value === key} onClick={() => { onChange(key); setOpen(false); trigger.current?.focus() }}>{format(day, 'd')}</button> })}</div><footer><button type="button" onClick={() => { const today = format(new Date(), 'yyyy-MM-dd'); onChange(today); setMonth(new Date()); setOpen(false); trigger.current?.focus() }}>Hoy</button><button type="button" onClick={() => { onChange(''); setOpen(false); trigger.current?.focus() }}><X size={12} />Limpiar</button></footer></div>}
  </div>
}
