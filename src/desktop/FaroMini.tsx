import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Profiler, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { FaroVoiceSnapshot } from '../features/voice/faroVoiceConfig'
import { cancelSilentConcentration, startSilentConcentration, startSilentConcentrationBreak, toggleSilentConcentrationPause } from '../features/computer/computerController'
import { FARO_DESKTOP_VOICE_SNAPSHOT_EVENT, getComputerConfig, getFaroDesktopVoiceSnapshot, hideFaroMini, requestFaroVoiceAction, showFaroMainWindow } from './desktopBridge'
import { MiniStateMachine } from './mini/MiniStateMachine'
import { MiniWindowController } from './mini/MiniWindowController'
import { attachMiniInteractions, beginMiniDrag, openMiniMenu, type MiniPreferences } from './mini/MiniInteractionController'
import { MiniView } from './mini/MiniView'
import { getMiniMetrics, recordMiniListeningPaint, recordMiniMetric } from './mini/MiniMetrics'
import { useMiniFocus } from './mini/useMiniFocus'
import './mini/mini.css'

export function FaroMini() {
  const [machine] = useState(() => new MiniStateMachine())
  const context = useSyncExternalStore(machine.subscribe, machine.getSnapshot)
  const { focus, active, setConfig } = useMiniFocus()
  const element = useRef<HTMLElement | null>(null)
  const windowController = useRef<MiniWindowController | undefined>(undefined)
  const actionRef = useRef<(action: string) => void>(() => {})

  useEffect(() => { machine.setFocus(Boolean(active)) }, [active, machine])
  useEffect(() => {
    let alive = true
    let voiceReceived = false
    let lastAudio = 0
    const cleanups: Array<() => void> = []
    const controller = new MiniWindowController(undefined, () => machine.fail('No pude ajustar Mini. Inténtalo de nuevo.'))
    windowController.current = controller
    const accept = (snapshot: FaroVoiceSnapshot) => {
      if (!alive) return
      // Audio drives one CSS variable, not the React tree or native bounds.
      if (snapshot.state === 'listening' && performance.now() - lastAudio >= 32) {
        element.current?.style.setProperty('--audio-level', String(Math.min(1, Math.max(0, snapshot.audioLevel ?? 0))))
        lastAudio = performance.now()
      }
      machine.voice(snapshot)
    }
    void listen<FaroVoiceSnapshot>(FARO_DESKTOP_VOICE_SNAPSHOT_EVENT, ({ payload }) => { voiceReceived = true; accept(payload) })
      .then((off) => {
        if (!alive) { off(); return }
        cleanups.push(off)
        void getFaroDesktopVoiceSnapshot().then((snapshot) => { if (!voiceReceived && snapshot) accept(snapshot.pendingAction ? snapshot : { state: 'ready' }) }).catch(() => { if (alive) machine.fail('No pude conectar FARO Voice.') })
      }).catch(() => { if (alive) machine.fail('No pude conectar FARO Voice.') })
    void attachMiniInteractions(machine, (action) => actionRef.current(action), () => alive).then((off) => { if (alive) cleanups.push(off); else off() }).catch(() => { if (alive) machine.fail('No pude conectar los controles de Mini.') })
    void listen<number>('faro://mini-audio-level', ({ payload }) => {
      if (alive && machine.getSnapshot().state === 'listening') element.current?.style.setProperty('--audio-level', String(Math.min(1, Math.max(0, payload))))
    }).then((off) => { if (alive) cleanups.push(off); else off() }).catch(() => {})
    void invoke<MiniPreferences>('mini_preferences').then((prefs) => { if (alive) machine.preferences(prefs.autoCollapse, prefs.reducedMotion) }).catch(() => {})
    controller.present(machine.getSnapshot().state)
    return () => { alive = false; cleanups.forEach((off) => off()); controller.dispose(); machine.dispose() }
  }, [machine])
  useEffect(() => { windowController.current?.present(context.state, context.snapshot.feedback) }, [context.state, context.snapshot.feedback])

  useEffect(() => {
    if (context.state !== 'listening') return
    const frame = requestAnimationFrame(recordMiniListeningPaint)
    return () => cancelAnimationFrame(frame)
  }, [context.state])

  const action = async (name: string) => {
    const current = machine.getSnapshot()
    try {
      if (name === 'menu') { await openMiniMenu(machine); return }
      if (name === 'hide') { if (current.locks.pendingConfirmation || current.locks.listening || current.locks.executing || current.locks.speaking) return; await hideFaroMini(); return }
      if (name === 'settings') { await invoke('open_main_route_command', { route: '/settings' }); return }
      if (name === 'main') { await showFaroMainWindow(); return }
      if (name === 'conversation') { await requestFaroVoiceAction('open'); return }
      if (name === 'collapse') { machine.collapse(); return }
      if (name === 'restore') { machine.restore(); return }
      if (name === 'expand_focus') { machine.expandFocus(); return }
      if (name === 'listening') { machine.invoke(); return }
      if (name === 'shortcut' && !['ambient', 'focus_compact'].includes(current.state)) { if (current.state === 'listening' && !current.locks.pendingConfirmation) await requestFaroVoiceAction('stop_listening'); else machine.collapse(); return }
      if (name === 'talk' || name === 'shortcut') { machine.invoke(); await requestFaroVoiceAction('open_and_listen'); return }
      if (name === 'stop') { await requestFaroVoiceAction('stop_listening'); return }
      if (name === 'confirm' || name === 'cancel') {
        if (!current.snapshot.pendingAction || current.locks.executing) return
        machine.lock('executing', true)
        await requestFaroVoiceAction(name)
        return
      }
      const operations = { focus: () => startSilentConcentration(), test_focus: () => startSilentConcentration(true), pause: toggleSilentConcentrationPause, break: startSilentConcentrationBreak, cancel_focus: cancelSilentConcentration }
      if (name in operations) {
        if (current.locks.focusConfig) return
        if (name === 'focus' && active) { machine.expandFocus(); return }
        machine.lock('focusConfig', true)
        try {
          await operations[name as keyof typeof operations]()
          const next = await getComputerConfig()
          if (next) setConfig(next)
        } finally { machine.lock('focusConfig', false) }
      }
    } catch { machine.lock('executing', false); machine.fail('No pude completar eso. Inténtalo de nuevo.'); }
  }
  useEffect(() => { actionRef.current = (name) => { void action(name) } })
  const view = <MiniView context={context} focus={focus} action={(name) => { void action(name) }} rootRef={(node) => { element.current = node }}
    drag={() => { void beginMiniDrag(machine) }} pointerPressed={(down) => machine.lock('pointerPressed', down)} controlFocus={(focused) => machine.lock('controlFocused', focused)} activate={() => { void invoke('mini_activate_control').catch(() => {}) }} />
  const debug = import.meta.env.DEV && new URLSearchParams(location.search).has('miniDebug')
  useEffect(() => {
    if (!debug) return
    const debugWindow = window as Window & { faroMiniMetrics?: typeof getMiniMetrics }
    debugWindow.faroMiniMetrics = getMiniMetrics
    return () => { delete debugWindow.faroMiniMetrics }
  }, [debug])
  return <>{debug ? <Profiler id="FaroMini" onRender={(_id, _phase, duration) => recordMiniMetric('renderMs', duration)}>{view}</Profiler> : view}{debug && <output className="mini-debug">{JSON.stringify({ state: context.state, zone: context.zone, locks: context.locks, focus: active, voice: context.snapshot.state, focusStatus: focus?.status, timers: machine.getDebug(), samples: getMiniMetrics().length })}</output>}</>
}
