import { Pause, Play, RotateCcw, Timer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { decodeDayFocus, focusKey, focusSeconds, idleDayFocus, pauseDayFocus, resumeDayFocus, type DayFocus } from './dayFocus'

export function DayFocusGadget({ ownerId }: { ownerId?: string }) {
  const key = ownerId ? focusKey(ownerId) : undefined
  const read = () => { try { return decodeDayFocus(key ? localStorage.getItem(key) : null) } catch { return idleDayFocus() } }
  const [session, setSession] = useState<DayFocus>(read)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!key) return
    try { localStorage.setItem(key, JSON.stringify(session)) } catch { /* Timer still works in this view when device storage is unavailable. */ }
  }, [key, session])
  useEffect(() => {
    if (!key) return
    const sync = (event: StorageEvent) => {
      if ((event.key === key || event.key === null) && event.storageArea === localStorage) {
        setSession(decodeDayFocus(event.key === null ? null : event.newValue)); setNow(Date.now())
      }
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [key])
  useEffect(() => {
    if (session.state !== 'running') return
    let interval: ReturnType<typeof setInterval> | undefined
    const tick = () => {
      const time = Date.now(); setNow(time)
      if (focusSeconds(session, time) === 0) setSession({ state: 'finished', remaining: 0 })
    }
    const resume = () => {
      clearInterval(interval)
      if (document.visibilityState !== 'hidden') { tick(); interval = setInterval(tick, 1000) }
    }
    resume()
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('pageshow', resume)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', resume); window.removeEventListener('pageshow', resume) }
  }, [session])
  const seconds = focusSeconds(session, now)
  const active = session.state !== 'idle'
  const display = active ? `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}` : '25 min'
  const toggle = () => { const time = Date.now(); setNow(time); setSession(current => current.state === 'running' ? pauseDayFocus(current, time) : resumeDayFocus(current, time)) }
  return <section className="day-mini day-focus" aria-labelledby="day-focus-title">
    <header><h2 id="day-focus-title">Enfoque</h2><Timer size={20} aria-hidden="true" /></header>
    <strong className="day-mini__value" role="timer" aria-label="Tiempo restante de enfoque" aria-live="off">{display}</strong>
    <div className="day-focus__controls" data-active={active}><button className="day-focus__toggle" type="button" onClick={toggle}>
      {session.state === 'running' ? <Pause size={18} /> : <Play size={18} />}
      {session.state === 'running' ? 'Pausar' : session.state === 'paused' ? 'Continuar' : session.state === 'finished' ? 'Otra sesión' : 'Iniciar enfoque'}
    </button>
    {active && <button type="button" className="day-focus__reset" aria-label="Reiniciar" title="Reiniciar enfoque" onClick={() => { setSession(idleDayFocus()); setNow(Date.now()) }}><RotateCcw size={16} aria-hidden="true" /></button>}</div>
    {session.state === 'finished' && <span className="day-focus__finished" role="status">Sesión completada</span>}
  </section>
}
