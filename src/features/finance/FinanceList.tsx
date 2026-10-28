import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** The list owns its wheel/touch gestures only while it can actually scroll. */
export function FinanceList({ label, children }: { label: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const items = useRef<HTMLDivElement>(null)
  const [scrollable, setScrollable] = useState(false)
  const measure = () => {
    const element = root.current
    if (element) setScrollable(element.scrollHeight > element.clientHeight + 1)
  }
  useLayoutEffect(measure)
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    if (root.current) observer.observe(root.current)
    if (items.current) observer.observe(items.current)
    return () => observer.disconnect()
  }, [])
  return <div ref={root} className="finance-expense-list" role="region" aria-label={label} tabIndex={0} data-scrollable={scrollable}><div ref={items} className="finance-list-items">{children}</div></div>
}
