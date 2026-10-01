import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MiniStateMachine, canAutoCollapse, type InteractionLock } from './MiniStateMachine'
import type { PendingVoiceAction } from '../../features/voice/voiceSchemas'
let machine: MiniStateMachine
beforeEach(() => { vi.useFakeTimers(); machine = new MiniStateMachine() })
afterEach(() => { machine.dispose(); vi.useRealTimers() })
const state = () => machine.getSnapshot().state
const wait = (ms: number) => vi.advanceTimersByTime(ms)

describe('Mini state and hover intent', () => {
  it('waits 180 ms near the orb; then waits 600 ms before collapsing', () => {
    machine.setZone('near'); wait(179); expect(state()).toBe('ambient')
    wait(1); expect(state()).toBe('peek')
    machine.setZone('far'); wait(599); expect(state()).toBe('peek')
    wait(1); expect(state()).toBe('ambient')
  })
  it('ignores a passing cursor and cancels collapse on reentry', () => {
    machine.setZone('near'); wait(100); machine.setZone('far'); wait(1000); expect(state()).toBe('ambient')
    machine.setZone('near'); wait(180); machine.setZone('far'); wait(500); machine.setZone('near'); wait(1000); expect(state()).toBe('peek')
  })
  it.each<InteractionLock>(['pointerPressed', 'dragging', 'menuOpen', 'controlFocused', 'focusConfig'])('never collapses with %s locked', (lock) => {
    machine.setZone('near'); wait(180); machine.lock(lock, true); machine.setZone('far'); wait(5000)
    expect(state()).toBe('peek'); expect(canAutoCollapse(machine.getSnapshot())).toBe(false)
    machine.lock(lock, false); wait(600); expect(state()).toBe('ambient')
  })
  it('holds when auto-collapse is disabled, but Escape still collapses', () => {
    machine.preferences(false, true); machine.setZone('near'); wait(180); machine.setZone('far'); wait(2000); expect(state()).toBe('peek')
    machine.collapse(); expect(state()).toBe('ambient')
  })
})
describe('Mini voice states', () => {
  it('listens immediately and holds understanding for 200 ms without delaying Voice', () => {
    machine.invoke(); expect(state()).toBe('listening')
    machine.voice({ state: 'understanding' }); wait(30)
    machine.voice({ state: 'speaking', feedback: 'Listo.' }); expect(state()).toBe('understanding')
    wait(170); expect(state()).toBe('speaking')
    machine.voice({ state: 'ready', feedback: 'Listo.' }); expect(state()).toBe('success')
    wait(1199); expect(state()).toBe('success'); wait(1); expect(state()).toBe('ambient')
  })
  it('does not flash consulting for a fast operation', () => {
    machine.voice({ state: 'understanding' }); machine.voice({ state: 'consulting' }); wait(100)
    machine.voice({ state: 'speaking' }); wait(300); expect(state()).toBe('speaking')
  })
  it('shows consulting after 300 ms and holds the busy state', () => {
    machine.voice({ state: 'consulting' }); wait(299); expect(state()).toBe('understanding')
    wait(1); expect(state()).toBe('consulting'); wait(5000); expect(state()).toBe('consulting')
  })
  it('does not restart the consulting delay on transcript updates', () => {
    machine.voice({ state: 'consulting' }); wait(200); machine.voice({ state: 'consulting', transcript: 'Fragmento' }); wait(100); expect(state()).toBe('consulting')
  })
  it('keeps pending confirmation until Voice Core resolves it, including on Escape', () => {
    machine.voice({ state: 'awaiting_confirmation', pendingAction: { id: 'pending', summary: 'Prueba', toolName: 'registerExpense' } as unknown as PendingVoiceAction })
    wait(10000); machine.collapse(); expect(state()).toBe('awaiting_confirmation')
    machine.voice({ state: 'executing' }); expect(state()).toBe('executing')
    machine.voice({ state: 'ready' }); wait(1200); expect(state()).toBe('ambient')
  })
  it('expires a compact error but waits while a pointer is inside', () => {
    machine.fail('Error'); machine.setZone('core'); wait(6000); expect(state()).toBe('error')
    machine.setZone('far'); expect(state()).toBe('ambient')
  })
  it('does not publish React updates for microphone-only snapshots', () => {
    machine.voice({ state: 'listening', audioLevel: 0 })
    const listener = vi.fn(); machine.subscribe(listener)
    for (let n = 0; n < 100; n++) machine.voice({ state: 'listening', audioLevel: n / 100 })
    expect(listener).not.toHaveBeenCalled()
  })
  it('recovers via shortcut from ambient and never cancels pending decisions', () => {
    machine.shortcut(); expect(state()).toBe('listening')
    machine.voice({ state: 'ready' }); expect(state()).toBe('ambient')
    machine.setZone('near'); wait(180); machine.shortcut(); expect(state()).toBe('ambient')
  })
})
describe('Focus surface handoff', () => {
  it('shows controls for 3 seconds, compacts and expands on intentional hover', () => {
    machine.setFocus(true); expect(state()).toBe('focus_expanded'); wait(2999); expect(state()).toBe('focus_expanded')
    wait(1); expect(state()).toBe('focus_compact'); machine.setZone('near'); wait(180); expect(state()).toBe('focus_expanded')
    machine.setZone('far'); wait(600); expect(state()).toBe('focus_compact')
  })
  it('returns from Voice to the existing Focus session', () => {
    machine.setFocus(true); wait(3000); machine.invoke(); expect(state()).toBe('listening')
    machine.voice({ state: 'speaking' }); machine.voice({ state: 'ready' }); wait(1200)
    expect(state()).toBe('focus_compact'); expect(machine.getSnapshot().focusActive).toBe(true)
  })
  it('Escape closes controls, not Focus', () => {
    machine.setFocus(true); machine.collapse(); expect(state()).toBe('focus_compact'); expect(machine.getSnapshot().focusActive).toBe(true)
  })
  it('disposal cancels all visual timers', () => {
    machine.setFocus(true); machine.setZone('near'); machine.dispose(); expect(vi.getTimerCount()).toBe(0)
  })
})

describe('Wake standby is a presentation boundary, not a microphone stop', () => {
  it('stays ambient while Core waits for FARO, then reacts immediately to a command', () => {
    machine.voice({ state: 'listening', waitingForWake: true })
    expect(state()).toBe('ambient')
    machine.voice({ state: 'listening', waitingForWake: false })
    expect(state()).toBe('listening')
    machine.voice({ state: 'speaking' })
    machine.voice({ state: 'listening', waitingForWake: true })
    expect(state()).toBe('success'); wait(1200); expect(state()).toBe('ambient')
  })
  it('shows executing even when the Core retains its pending action during the request', () => {
    const pendingAction = { id: 'pending', summary: 'Prueba', toolName: 'registerExpense' } as unknown as PendingVoiceAction
    machine.voice({ state: 'awaiting_confirmation', pendingAction })
    machine.invoke(); expect(state()).toBe('awaiting_confirmation')
    machine.voice({ state: 'executing', pendingAction }); expect(state()).toBe('executing')
  })
  it('restore does not falsify the global cursor zone or prevent auto-collapse', () => {
    machine.restore(); expect(state()).toBe('peek'); expect(machine.getSnapshot().zone).toBe('far')
    wait(600); expect(state()).toBe('ambient')
  })
})

 it('releases focus held by a confirmation control when that control disappears', () => {
   machine.voice({ state: 'awaiting_confirmation', pendingAction: { id: 'p', summary: 'Prueba' } as unknown as PendingVoiceAction })
   machine.lock('controlFocused', true)
   machine.voice({ state: 'executing' }); machine.voice({ state: 'ready' }); wait(1200)
   expect(state()).toBe('ambient')
 })
