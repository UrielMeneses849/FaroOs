import type { FaroVoiceSnapshot } from '../../features/voice/faroVoiceConfig'
import { markMiniWake, recordMiniMetric } from './MiniMetrics'

export type FaroMiniState = 'ambient' | 'peek' | 'listening' | 'understanding' | 'consulting' | 'awaiting_confirmation' | 'executing' | 'speaking' | 'success' | 'focus_compact' | 'focus_expanded' | 'error'
export type CursorZone = 'core' | 'near' | 'far'
export type InteractionLock = 'pointerInside' | 'pointerPressed' | 'controlFocused' | 'dragging' | 'menuOpen' | 'pendingConfirmation' | 'speaking' | 'listening' | 'executing' | 'focusConfig'
export interface MiniContext {
  state: FaroMiniState
  zone: CursorZone
  locks: Record<InteractionLock, boolean>
  focusActive: boolean
  snapshot: FaroVoiceSnapshot
  autoCollapse: boolean
  reducedMotion: boolean
}
const lockedStates = new Set<FaroMiniState>(['listening', 'understanding', 'consulting', 'executing', 'speaking', 'awaiting_confirmation'])
export function canAutoCollapse(context: MiniContext) {
  return context.autoCollapse && !lockedStates.has(context.state) && !Object.values(context.locks).some(Boolean)
}
const initial = (): MiniContext => ({ state: 'ambient', zone: 'far', focusActive: false, snapshot: { state: 'ready' }, autoCollapse: true, reducedMotion: false, locks: { pointerInside: false, pointerPressed: false, controlFocused: false, dragging: false, menuOpen: false, pendingConfirmation: false, speaking: false, listening: false, executing: false, focusConfig: false } })

function presentationState(snapshot: FaroVoiceSnapshot) {
  return snapshot.state === 'executing' ? 'executing' : snapshot.pendingAction ? 'awaiting_confirmation' : snapshot.waitingForWake && snapshot.state === 'listening' ? 'ready' : snapshot.wakeState === 'detected' && snapshot.state === 'ready' ? 'listening' : snapshot.state
}

/** The only owner of presentation and its timers. Voice/Focus remain the domain owners. */
export class MiniStateMachine {
  private context = initial()
  private listeners = new Set<() => void>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private enteredAt = Date.now()
  private zoneEnteredAt = Date.now()
  private focusGraceUntil = 0
  private voiceKey = ''
  private successElapsed = false
  private errorElapsed = false
  getSnapshot = () => this.context
  getDebug = () => ({ collapseTimer: this.timers.has('collapse'), hoverTimer: this.timers.has('hover'), visualTimer: this.timers.has('voice') })
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(patch: Partial<MiniContext>) { this.context = { ...this.context, ...patch }; this.listeners.forEach((listener) => listener()) }
  private cancel(name: string) { clearTimeout(this.timers.get(name)); this.timers.delete(name) }
  private schedule(name: string, ms: number, callback: () => void) {
    if (this.timers.has(name)) return
    this.timers.set(name, setTimeout(() => { this.timers.delete(name); callback() }, ms))
  }
  private base(): FaroMiniState { return this.context.focusActive ? 'focus_compact' : 'ambient' }
  private transition(state: FaroMiniState) {
    if (state === this.context.state) return
    this.cancel('collapse'); this.cancel('hover'); this.cancel('success'); this.cancel('error')
    this.enteredAt = Date.now()
    this.successElapsed = false; this.errorElapsed = false
    // A replaced presentation removes its focused controls. Do not retain a
    // keyboard lock after confirming via Enter and unmounting that button.
    this.publish({ state, locks: { ...this.context.locks, controlFocused: false } })
    recordMiniMetric('stateTransitions')
    if (state === 'success') this.schedule('success', 1200, () => { this.successElapsed = true; this.reconcile() })
    if (state === 'error') this.schedule('error', 5000, () => { this.errorElapsed = true; this.reconcile() })
    this.reconcile()
  }
  private reconcile() {
    const c = this.context
    if (!canAutoCollapse(c) || c.zone !== 'far') { this.cancel('collapse'); return }
    if ((c.state === 'success' && this.successElapsed) || (c.state === 'error' && this.errorElapsed)) { this.transition(this.base()); return }
    if (c.state === 'peek' || c.state === 'focus_expanded') {
      const delay = c.state === 'focus_expanded' ? Math.max(600, this.focusGraceUntil - Date.now()) : 600
      this.schedule('collapse', delay, () => {
        if (canAutoCollapse(this.context) && this.context.zone === 'far') {
          recordMiniMetric('farToCollapseMs', Date.now() - this.zoneEnteredAt)
          this.transition(this.base())
        }
      })
    }
  }
  private maybeHover() {
    const c = this.context
    if (c.zone === 'far' || c.locks.dragging || c.locks.pointerPressed || c.locks.menuOpen || !['ambient', 'focus_compact'].includes(c.state)) return
    this.schedule('hover', 180, () => {
      const next = this.context
      if (next.zone !== 'far' && !next.locks.dragging && !next.locks.pointerPressed && !next.locks.menuOpen) {
        recordMiniMetric('hoverToPeekMs', Date.now() - this.zoneEnteredAt)
        this.transition(next.focusActive ? 'focus_expanded' : 'peek')
      }
    })
  }
  setZone(zone: CursorZone) {
    if (zone === this.context.zone) return
    this.zoneEnteredAt = Date.now()
    this.publish({ zone, locks: { ...this.context.locks, pointerInside: zone === 'core' } })
    if (zone === 'far') this.cancel('hover')
    else {
      this.cancel('collapse')
      this.maybeHover()
    }
    this.reconcile()
  }
  lock(name: InteractionLock, value: boolean) {
    if (this.context.locks[name] === value) return
    this.publish({ locks: { ...this.context.locks, [name]: value } })
    if (value && ['pointerPressed', 'dragging', 'menuOpen'].includes(name)) this.cancel('hover')
    else if (!value) this.maybeHover()
    this.reconcile()
  }
  preferences(autoCollapse: boolean, reducedMotion: boolean) { this.publish({ autoCollapse, reducedMotion }); this.reconcile() }
  setFocus(active: boolean) {
    if (active === this.context.focusActive) return
    this.focusGraceUntil = active ? Date.now() + 3000 : 0
    this.publish({ focusActive: active })
    if (['ambient', 'peek', 'focus_compact', 'focus_expanded'].includes(this.context.state)) this.transition(active ? 'focus_expanded' : 'ambient')
  }
  invoke() {
    if (this.context.locks.pendingConfirmation) return
    this.cancel('voice')
    this.lock('listening', true)
    this.voiceKey = ''
    this.publish({ snapshot: { state: 'listening', inputStatus: 'opening' } })
    this.cancel('input-start')
    this.schedule('input-start', 22000, () => this.fail('No pude activar el micrófono. Reintenta o abre FARO para revisar la conexión.'))
    markMiniWake()
    this.transition('listening')
  }
  shortcut() {
    if (this.context.state === 'ambient' || this.context.state === 'focus_compact') this.invoke()
    else this.collapse()
  }
  collapse() {
    // Escape/shortcut never cancel a pending action, voice turn, or Focus session.
    if (canAutoCollapse({ ...this.context, autoCollapse: true, locks: { ...this.context.locks, pointerInside: false, controlFocused: false } })) this.transition(this.base())
  }
  restore() { if (['ambient', 'peek'].includes(this.context.state)) this.transition('peek'); else if (this.context.state === 'focus_compact') this.transition('focus_expanded') }
  expandFocus() { if (this.context.focusActive && !lockedStates.has(this.context.state)) this.transition('focus_expanded') }
  fail(message: string) {
    this.voice({ ...this.context.snapshot, state: 'error', feedback: message })
  }
  voice(snapshot: FaroVoiceSnapshot) {
    const { audioLevel: _audioLevel, ...semantic } = snapshot
    void _audioLevel
    const key = JSON.stringify(semantic)
    if (key === this.voiceKey) return
    this.voiceKey = key
    if (snapshot.inputStatus === 'active' || snapshot.state !== 'listening' || snapshot.pendingAction) this.cancel('input-start')
    const previous = this.context.snapshot
    const state = presentationState(snapshot)
    this.publish({ snapshot: semantic, locks: { ...this.context.locks, pendingConfirmation: Boolean(snapshot.pendingAction), listening: state === 'listening', speaking: state === 'speaking', executing: state === 'executing' } })
    // Updating a transcript must not restart visibility thresholds.
    if (state !== 'ready' && state === presentationState(previous) && Boolean(previous.pendingAction) === Boolean(snapshot.pendingAction) && this.context.state !== 'ambient' && this.context.state !== 'focus_compact') return
    this.cancel('voice')
    if (state === 'ready') {
      if (['speaking', 'executing', 'consulting', 'understanding', 'awaiting_confirmation'].includes(this.context.state)) {
        const delay = this.context.state === 'understanding' ? Math.max(0, 200 - (Date.now() - this.enteredAt)) : 0
        if (delay) this.schedule('voice', delay, () => this.transition('success')); else this.transition('success')
      } else if (this.context.state === 'listening') this.transition(this.base())
      return
    }
    if (state === 'consulting') {
      if (!['understanding', 'consulting'].includes(this.context.state)) this.transition('understanding')
      this.schedule('voice', 300, () => this.transition('consulting'))
    } else if (state !== 'listening' && state !== 'awaiting_confirmation' && state !== 'error' && this.context.state === 'understanding' && Date.now() - this.enteredAt < 200) {
      this.schedule('voice', 200 - (Date.now() - this.enteredAt), () => this.transition(state))
    } else { if (state === 'listening' && this.context.state !== 'listening') markMiniWake(); this.transition(state) }
  }
  dispose() { this.timers.forEach(clearTimeout); this.timers.clear(); this.listeners.clear() }
}
