import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, Mic, Square as StopIcon, Pause, Play, Square, Timer, X } from 'lucide-react'
import type { FocusSession } from '../../features/computer/computerTypes'
import { focusRemainingSeconds } from '../../features/computer/focusLifecycle'
import type { MiniContext } from './MiniStateMachine'
import orbUrl from '../../assets/faro-orb-v1.png'

const labels = { ambient: 'En espera', peek: 'En espera', listening: 'Te escucho', understanding: 'Entendiendo…', consulting: 'Consultando…', awaiting_confirmation: 'Confirmar acción', executing: 'Ejecutando…', speaking: 'FARO', success: 'Listo', focus_compact: 'Concentración', focus_expanded: 'Concentración', error: 'No pude completar eso' }
export function MiniFocusClock({ focus }: { focus: FocusSession }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { if (focus.status === 'paused') return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [focus.status])
  const seconds = focusRemainingSeconds(focus, new Date(now))
  const total = (focus.phase === 'break' ? focus.breakDurationMinutes ?? 15 : focus.plannedDurationMinutes) * 60
  return <div className="mini-focus-clock" style={{ '--focus-progress': `${100 * (1 - seconds / Math.max(1, total))}%` } as CSSProperties}><strong>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</strong><span>{focus.status === 'paused' ? 'En pausa' : focus.phase === 'break' ? 'Descanso' : 'Concentración'}</span></div>
}
interface Props {
  context: MiniContext
  focus?: FocusSession
  action: (action: string) => void
  drag: () => void
  controlFocus: (focused: boolean) => void
  pointerPressed: (pressed: boolean) => void
  activate: () => void
  rootRef: (node: HTMLElement | null) => void
}
export function MiniView({ context: c, focus, action, drag, controlFocus, pointerPressed, activate, rootRef }: Props) {
  const pointer = useRef<{ x: number; y: number; dragged: boolean } | undefined>(undefined)
  const state = c.state
  const ambient = state === 'ambient'
  const focusVisible = state === 'focus_compact' || state === 'focus_expanded'
  const pending = c.snapshot.pendingAction
  const response = c.snapshot.feedback?.trim() || ''
  const pointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    pointer.current = { x: event.clientX, y: event.clientY, dragged: false }
    pointerPressed(true)
  }
  const pointerMove = (event: ReactPointerEvent) => {
    const start = pointer.current
    if (start && !start.dragged && event.buttons === 1 && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) { start.dragged = true; drag() }
  }
  return <main ref={rootRef} className="mini-surface" data-state={state} data-reduced-motion={c.reducedMotion} aria-label="FARO Mini"
    onContextMenu={(event) => { event.preventDefault(); action('menu') }}
    onPointerDownCapture={(event) => { pointerPressed(true); if ((event.target as HTMLElement).closest('[data-mini-control]')) activate() }}
    onPointerUpCapture={() => pointerPressed(false)}
    onFocusCapture={(event) => { const target = event.target as HTMLElement; controlFocus(target.matches('input, select, textarea') || (target.matches(':focus-visible') && !target.closest('.mini-orb'))) }}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) controlFocus(false) }}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); action('collapse') } }}>
    <button className="mini-orb" type="button" aria-label={focusVisible ? 'Mostrar controles de concentración' : 'Hablar con FARO'} onPointerDown={pointerDown} onPointerMove={pointerMove}
      onClick={() => { if (!pointer.current?.dragged) action(focusVisible ? 'expand_focus' : 'talk'); pointer.current = undefined }}>
      <span className="mini-orb-ring" aria-hidden="true" /><img src={orbUrl} alt="" draggable={false} />{state === 'success' && <Check className="mini-orb-accent" size={15} aria-hidden="true" />}
    </button>
    {!ambient && <div className="mini-copy" key={state}>
      <strong className="mini-label" aria-live="polite">{state === 'peek' ? 'FARO' : state === 'listening' && c.snapshot.inputStatus !== 'active' ? (c.snapshot.inputStatus === 'connecting' ? 'Conectando voz…' : 'Abriendo micrófono…') : labels[state]}</strong>
      {state === 'peek' && <button className="mini-focus-start" data-mini-control onClick={() => action('focus')} disabled={c.locks.focusConfig}><Timer size={13} />Concentración</button>}
      {state === 'listening' && <span className="mini-input-status"><Mic size={12} />{c.snapshot.inputStatus === 'active' ? 'Micrófono activo' : c.snapshot.inputStatus === 'connecting' ? 'Micrófono abierto' : 'Preparando entrada'}</span>}
      {state === 'listening' && c.snapshot.inputStatus === 'active' && <div className="mini-meter" aria-label="Nivel del micrófono">{[.45, .8, 1, .65, .9, .55, .75].map((weight, index) => <i key={index} style={{ '--weight': weight } as CSSProperties} />)}</div>}
      {state === 'listening' && c.snapshot.feedback && <p role="status">{c.snapshot.feedback}</p>}
      {state === 'listening' && c.snapshot.transcript && <p>{c.snapshot.transcript}</p>}
      {state === 'speaking' && <p>{response || 'Te estoy respondiendo…'}</p>}
      {state === 'success' && <p>{response || 'Acción completada'}</p>}
      {state === 'error' && <p>{response || 'Inténtalo de nuevo desde FARO.'}</p>}
      {state === 'awaiting_confirmation' && pending && <><p className="mini-proposal">{pending.summary}</p>{c.snapshot.state === 'error' && <p role="alert">{response}</p>}</>}
    </div>}
    {focusVisible && focus && <MiniFocusClock focus={focus} />}
    {state === 'focus_expanded' && focus && <div className="mini-actions">
      <button data-mini-control onClick={() => action('pause')} disabled={c.locks.focusConfig}>{focus.status === 'paused' ? <Play size={13} /> : <Pause size={13} />}{focus.status === 'paused' ? 'Reanudar' : 'Pausar'}</button>
      {focus.phase !== 'break' && <button data-mini-control onClick={() => action('break')} disabled={c.locks.focusConfig}><Timer size={13} />Descansar</button>}
      <button data-mini-control onClick={() => action('settings')}>Tiempos</button>
      <button data-mini-control onClick={() => action('cancel_focus')} disabled={c.locks.focusConfig}><Square size={12} />Cancelar</button>
    </div>}
    {state === 'awaiting_confirmation' && <div className="mini-actions"><button data-mini-control className="mini-primary" onClick={() => action('confirm')} disabled={c.locks.executing}>Confirmar</button><button data-mini-control onClick={() => action('cancel')} disabled={c.locks.executing}>Cancelar</button></div>}
    {state === 'error' && <div className="mini-actions"><button data-mini-control onClick={() => action('talk')}>Reintentar</button><button data-mini-control onClick={() => action('main')}>Abrir FARO</button></div>}
    {state === 'listening' && <button className="mini-stop" data-mini-control aria-label="Detener escucha" onClick={() => action('stop')}><StopIcon size={12} /></button>}
    {state === 'speaking' && <button className="mini-conversation" data-mini-control onClick={() => action('conversation')}>Ver conversación</button>}
    {state === 'peek' && <div className="mini-actions"><button data-mini-control onClick={() => action('test_focus')} disabled={c.locks.focusConfig}>Probar 10 s / 5 s</button><button data-mini-control onClick={() => action('settings')}>Tiempos</button></div>}
    {state === 'peek' && <button className="mini-close" aria-label="Ocultar Mini" data-mini-control onClick={() => action('hide')}><X size={12} /></button>}
  </main>
}
