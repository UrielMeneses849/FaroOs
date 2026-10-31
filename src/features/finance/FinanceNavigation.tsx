import { financeDecisionPanels } from './financePanels'
import { ChevronDown } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

const primaryFinancePanels = [
  ['overview', 'Resumen'], ['advisor', 'Proyecciones'], ['income', 'Ingresos'],
  ['recurring', 'Gastos'], ['plan', 'Plan'], ['transactions', 'Movimientos'], ['budgets', 'Presupuestos'],
] as const
const secondaryFinancePanels = [['savings', 'Ahorro'], ['goals', 'Metas'], ['accounts', 'Cuentas'], ['fund', 'Fondo']] as const
export type FinancePanel = typeof primaryFinancePanels[number][0] | typeof secondaryFinancePanels[number][0] | typeof financeDecisionPanels[number][0]

export function FinanceNavigation({ value, onChange, onManageCategories }: { value: FinancePanel; onChange: (panel: FinancePanel) => void; onManageCategories: () => void }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  const secondary = [...secondaryFinancePanels, ...financeDecisionPanels].find(([key]) => key === value)
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus() }
  const choices = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"], [role="menuitem"]') ?? [])]
  useLayoutEffect(() => {
    if (!open || !trigger.current) return
    const rect = trigger.current.getBoundingClientRect()
    const height = Math.min(menu.current?.scrollHeight ?? 520, window.innerHeight - 24)
    setPosition({ left: Math.max(8, Math.min(rect.right - 280, window.innerWidth - 288)), top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - height - 8)) })
    const selected = menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
    ;(selected ?? choices()[0])?.focus()
  }, [open])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false) }
    const resize = () => setOpen(false)
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', resize)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', resize) }
  }, [open])
  return <>
    <nav className="finance-tabs" aria-label="Secciones financieras">
      {primaryFinancePanels.map(([key, label]) => <button key={key} type="button" className={value === key ? 'active' : ''} aria-current={value === key ? 'page' : undefined} onClick={() => { close(); onChange(key) }}>{label}</button>)}
    </nav>
    <button ref={trigger} type="button" className={`finance-more-trigger${secondary ? ' active' : ''}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(current => !current)} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) }
    }}>{secondary ? `Más: ${secondary[1]}` : 'Más'}<ChevronDown size={14} aria-hidden="true" /></button>
    {open && createPortal(<div ref={menu} id={id} className="finance-more-menu" style={position} role="menu" aria-label="Más secciones de Finanzas" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); close(true); return }
      if (event.key === 'Tab') { close(true); return }
      const entries = choices(), index = entries.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : event.key === 'ArrowDown' ? (index + 1) % entries.length : event.key === 'ArrowUp' ? (index + entries.length - 1) % entries.length : -1
      if (next >= 0) { event.preventDefault(); entries[next]?.focus() }
    }}>
      {secondaryFinancePanels.map(([key, label]) => <button key={key} type="button" role="menuitemradio" aria-checked={key === value} onClick={() => { close(true); onChange(key) }}>{label}</button>)}
      <div className="finance-more-menu__divider" />
      <span className="finance-more-menu__heading">Decisiones y simulaciones</span>
      {financeDecisionPanels.map(([key, label]) => <button key={key} type="button" role="menuitemradio" aria-checked={key === value} onClick={() => { close(true); onChange(key) }}>{label}</button>)}
      <div className="finance-more-menu__divider" />
      <button type="button" role="menuitem" onClick={() => { close(); onManageCategories() }}>Gestionar categorías</button>
    </div>, document.body)}
  </>
}
