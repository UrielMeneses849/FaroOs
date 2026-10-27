import { CalendarDays, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/auth'
import { householdRepository } from '../../repositories/householdRepository'
import { pesos, shoppingSaturday, suggestedQuantity } from './household'
import './weekend-report.css'

type Report = { owner: string; week: string; count: number; total: number; unknown: number }
const dismissedKey = (owner: string, week: string) => `faro.needs.report.dismissed.${owner}.${week}`
const wasDismissed = (owner: string, week: string) => {
  try { return localStorage.getItem(dismissedKey(owner, week)) === 'true' } catch { return false }
}

/** An in-app Friday/Saturday report. No permission prompts or background push. */
export function NeedsWeekendReport() {
  const { user } = useAuth()
  const owner = user?.id
  const lab = user?.is_anonymous || user?.user_metadata?.faro_mode === 'ai_test_lab'
  const [report, setReport] = useState<Report>()
  useEffect(() => {
    if (!owner || lab) return
    let active = true
    const check = async () => {
      const now = new Date()
      const week = shoppingSaturday(now)
      if (document.visibilityState !== 'visible') return
      if (![5, 6].includes(now.getDay()) || wasDismissed(owner, week)) { setReport(undefined); return }
      try {
        const snapshot = await householdRepository.load(owner)
        if (!active || !snapshot || wasDismissed(owner, week)) return
        const products = snapshot.state.products.filter(p => suggestedQuantity(p, week) > 0)
        if (!products.length) { setReport(undefined); return }
        setReport({ owner, week, count: products.length, total: products.reduce((sum, p) => sum + Math.round(suggestedQuantity(p, week) * (p.priceCents ?? 0)), 0), unknown: products.filter(p => p.priceCents === undefined).length })
      } catch { /* An unavailable report must never interrupt the app. */ }
    }
    void check()
    const interval = window.setInterval(() => void check(), 30 * 60 * 1000)
    const onVisible = () => void check()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('faro:household-updated', onVisible)
    return () => { active = false; window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('faro:household-updated', onVisible) }
  }, [owner, lab])
  const now = new Date()
  if (!report || report.owner !== owner || lab || ![5, 6].includes(now.getDay()) || report.week !== shoppingSaturday(now)) return null
  const dismiss = () => {
    try { localStorage.setItem(dismissedKey(report.owner, report.week), 'true') } catch { /* Session dismissal still works. */ }
    setReport(undefined)
  }
  return <aside className="needs-weekend-report" role="status"><CalendarDays size={22} /><div><strong>Tu compra del sábado</strong><p>{report.count} {report.count === 1 ? 'producto' : 'productos'} por reponer · {pesos(report.total)}{report.unknown ? ` + ${report.unknown} sin precio` : ' estimado'}</p><a href={`${import.meta.env.BASE_URL}needs`} onClick={dismiss}>Revisar reporte y lista</a></div><button aria-label="Cerrar reporte del sábado" onClick={dismiss}><X size={18} /></button></aside>
}
