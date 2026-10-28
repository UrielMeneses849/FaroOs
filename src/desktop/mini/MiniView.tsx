import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { CalendarDays, CheckSquare, Ellipsis, Mic, Square as StopIcon, Pause, Play, Plus, Square, Timer, X } from 'lucide-react'
import type { FocusSession } from '../../features/computer/computerTypes'
import { focusRemainingSeconds } from '../../features/computer/focusLifecycle'
import { canStartMiniVoice, type MiniContext } from './MiniStateMachine'
import orbUrl from '../../assets/faro-orb-v1.png'

const labels = { ambient: 'En espera', peek: 'En espera', listening: 'Te escucho', understanding: 'Entendiendo…', consulting: 'Consultando…', awaiting_confirmation: 'Confirmar acción', executing: 'Ejecutando…', speaking: 'FARO', success: 'Respuesta de FARO', focus_compact: 'Concentración', focus_expanded: 'Concentración', error: 'No pude completar eso' }
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
    onPointerCancelCapture={() => pointerPressed(false)}
    onFocusCapture={(event) => { const target = event.target as HTMLElement; controlFocus(target.matches('input, select, textarea') || (target.matches(':focus-visible') && !target.closest('.mini-orb'))) }}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) controlFocus(false) }}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); action('collapse') } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); action('menu') } }}>
    <button className="mini-orb" data-mini-control type="button" aria-disabled={!focusVisible && !canStartMiniVoice(c)} aria-label={focusVisible ? 'Mostrar controles de concentración' : 'Hablar con FARO'} onPointerDown={pointerDown} onPointerMove={pointerMove}
      onClick={() => { if (!pointer.current?.dragged && (focusVisible || canStartMiniVoice(c))) action(focusVisible ? 'expand_focus' : 'talk'); pointer.current = undefined }}>
      <span className="mini-orb-ring" aria-hidden="true" /><img src={orbUrl} alt="" draggable={false} />
    </button>
    {!ambient && <div className="mini-copy" key={state}>
      <strong className="mini-label" aria-live="polite">{state === 'peek' ? 'FARO' : state === 'listening' && c.snapshot.inputStatus !== 'active' ? (c.snapshot.inputStatus === 'connecting' ? 'Conectando voz…' : 'Abriendo micrófono…') : labels[state]}</strong>
      {state === 'peek' && <button className="mini-focus-start" data-mini-control onClick={() => action('focus')} disabled={c.locks.focusConfig}><Timer size={13} />Concentración</button>}
      {state === 'listening' && <span className="mini-input-status"><Mic size={12} />{c.snapshot.inputStatus === 'active' ? 'Micrófono activo' : c.snapshot.inputStatus === 'connecting' ? 'Micrófono abierto' : 'Preparando entrada'}</span>}
      {state === 'listening' && c.snapshot.inputStatus === 'active' && <div className="mini-meter" aria-label="Nivel del micrófono">{[.45, .8, 1, .65, .9, .55, .75].map((weight, index) => <i key={index} style={{ '--weight': weight } as CSSProperties} />)}</div>}
      {state === 'listening' && (c.snapshot.feedback || c.snapshot.transcript) && <div className="mini-feedback-scroll" data-mini-control tabIndex={0} role="log" aria-label="Transcripción en curso">{c.snapshot.feedback && <p>{c.snapshot.feedback}</p>}{c.snapshot.transcript && <p>{c.snapshot.transcript}</p>}</div>}
      {state === 'speaking' && <p className="mini-feedback-scroll" data-mini-control tabIndex={0} aria-label="Respuesta completa de FARO">{response || 'Te estoy respondiendo…'}</p>}
      {state === 'success' && response && <p className="mini-feedback-scroll" data-mini-control tabIndex={0} aria-label="Respuesta completa de FARO">{response}</p>}
      {state === 'error' && <p className="mini-feedback-scroll" data-mini-control tabIndex={0} role="alert">{response || 'Inténtalo de nuevo desde FARO.'}</p>}
      {state === 'awaiting_confirmation' && pending && <div className="mini-feedback-scroll" data-mini-control tabIndex={0} role="region" aria-label="Detalle completo de la acción"><p className="mini-proposal mini-proposal--full">{pending.summary}</p>{pending.possibleDuplicate && <p className="mini-duplicate" role="alert">Posible duplicado: {pending.possibleDuplicate.description} · {new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(pending.possibleDuplicate.amount)} · {pending.possibleDuplicate.date}</p>}{c.snapshot.state === 'error' && <p role="alert">{response}</p>}</div>}
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
    {(state === 'speaking' || state === 'success' || state === 'executing') && <button className="mini-conversation" data-mini-control onClick={() => action('main')}>Abrir FARO</button>}
    {state === 'peek' && <nav className="mini-shortcuts" aria-label="Acciones rápidas"><button data-mini-control onClick={() => action('today')}><CalendarDays size={14} />Hoy</button><button data-mini-control onClick={() => action('new_task')}><CheckSquare size={14} />Nueva tarea</button><button data-mini-control onClick={() => action('movement')}><Plus size={14} />Movimiento</button></nav>}
    {!ambient && <button className="mini-menu-button" data-mini-control aria-label="Más opciones de FARO Mini" aria-haspopup="menu" onClick={() => action('menu')}><Ellipsis size={16} /></button>}
    {state === 'peek' && <button className="mini-open-main" data-mini-control onClick={() => action('main')}>Abrir FARO</button>}
    {state === 'peek' && <button className="mini-close" aria-label="Ocultar Mini" data-mini-control onClick={() => action('hide')}><X size={12} /></button>}
  </main>
}
