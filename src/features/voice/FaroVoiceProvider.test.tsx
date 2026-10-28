import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FaroVoicePresence } from './FaroVoicePresence'
import { FARO_VOICE_ACTION_EVENT } from './desktopVoiceEvents'
import { FaroVoiceProvider, useFaroVoice } from './FaroVoiceProvider'

const panel = vi.hoisted(() => vi.fn())
vi.mock('./VoicePanel', () => ({ VoicePanel: (props: unknown) => { panel(props); return <div data-testid="voice-panel" /> } }))

function Accesses() {
  const { openFaroVoice, surface, open } = useFaroVoice()
  return <><button onClick={() => openFaroVoice({ surface: 'dashboard' })}>Dashboard</button><button onClick={() => openFaroVoice({ surface: 'today' })}>Hoy</button><button onClick={() => openFaroVoice({ surface: 'finances' })}>Finanzas</button><output>{open ? surface : 'closed'}</output></>
}

describe('FaroVoiceProvider', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks() })
  it('abre una sola instancia global con el contexto de cada superficie', () => {
    render(<FaroVoiceProvider><Accesses /></FaroVoiceProvider>)
    expect(screen.getAllByTestId('voice-panel')).toHaveLength(1)
    fireEvent.click(screen.getByText('Dashboard')); expect(screen.getByText('dashboard')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Hoy')); expect(screen.getByText('today')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Finanzas')); expect(screen.getByText('finances')).toBeInTheDocument()
    expect(screen.getAllByTestId('voice-panel')).toHaveLength(1)
  })

  it('permite embeber Finanzas en FARO Lab sin el provider productivo', () => {
    expect(() => render(<FaroVoicePresence surface="finances" />)).not.toThrow()
    expect(screen.queryByRole('button', { name: /abrir faro voice/i })).not.toBeInTheDocument()
  })
})

it('desktop Talk activates the existing command-listening path without opening another provider', () => {
  render(<FaroVoiceProvider><Accesses /></FaroVoiceProvider>)
  expect(panel.mock.lastCall?.[0]).toMatchObject({ open: false, activateOnStart: false })
  fireEvent(window, new CustomEvent(FARO_VOICE_ACTION_EVENT, { detail: 'open_and_listen' }))
  expect(panel.mock.lastCall?.[0]).toMatchObject({ open: true, presentation: 'mini', activateOnStart: true })
  expect(screen.getAllByTestId('voice-panel')).toHaveLength(1)
})


it('normal voice access clears the prior Mini microphone activation', () => {
  render(<FaroVoiceProvider><Accesses /></FaroVoiceProvider>)
  fireEvent(window, new CustomEvent(FARO_VOICE_ACTION_EVENT, { detail: 'open_and_listen' }))
  expect(panel.mock.lastCall?.[0]).toMatchObject({ presentation: 'mini', autoStartToken: 1, activateOnStart: true })
  fireEvent.click(screen.getByText('Dashboard'))
  expect(panel.mock.lastCall?.[0]).toMatchObject({ open: true, presentation: 'modal', autoStartToken: 0, activateOnStart: false })
})

it.each(['awaiting_confirmation', 'executing', 'consulting', 'understanding', 'speaking', 'listening'] as const)('does not restart Mini from a native Talk action during %s', state => {
  render(<FaroVoiceProvider><Accesses /></FaroVoiceProvider>)
  fireEvent(window, new CustomEvent(FARO_VOICE_ACTION_EVENT, { detail: 'open_and_listen' }))
  const props = panel.mock.lastCall?.[0] as { onSnapshotChange: (snapshot: { state: typeof state }) => void }
  act(() => props.onSnapshotChange({ state }))
  fireEvent(window, new CustomEvent(FARO_VOICE_ACTION_EVENT, { detail: 'open_and_listen' }))
  expect(panel.mock.lastCall?.[0]).toMatchObject({ presentation: 'mini', autoStartToken: 1, activateOnStart: true })
})


it('coalesces native Talk events that arrive before React commits', () => {
  render(<FaroVoiceProvider><Accesses /></FaroVoiceProvider>)
  act(() => {
    window.dispatchEvent(new CustomEvent(FARO_VOICE_ACTION_EVENT, { detail: 'open_and_listen' }))
    window.dispatchEvent(new CustomEvent(FARO_VOICE_ACTION_EVENT, { detail: 'open_and_listen' }))
  })
  expect(panel.mock.lastCall?.[0]).toMatchObject({ presentation: 'mini', autoStartToken: 1 })
})

it('protects an errored pending proposal immediately, and allows retry after an error without one', () => {
  render(<FaroVoiceProvider><Accesses /></FaroVoiceProvider>)
  fireEvent(window, new CustomEvent(FARO_VOICE_ACTION_EVENT, { detail: 'open_and_listen' }))
  const props = panel.mock.lastCall?.[0] as { onSnapshotChange: (snapshot: import('./faroVoiceConfig').FaroVoiceSnapshot) => void }
  act(() => {
    props.onSnapshotChange({ state: 'error', pendingAction: { requestId: '00000000-0000-4000-8000-000000000001', toolName: 'createExpense', arguments: { amount: 120 }, summary: 'Registrar gasto de $120' } })
    window.dispatchEvent(new CustomEvent(FARO_VOICE_ACTION_EVENT, { detail: 'open_and_listen' }))
  })
  expect(panel.mock.lastCall?.[0]).toMatchObject({ autoStartToken: 1 })
  act(() => {
    props.onSnapshotChange({ state: 'error' })
    window.dispatchEvent(new CustomEvent(FARO_VOICE_ACTION_EVENT, { detail: 'open_and_listen' }))
  })
  expect(panel.mock.lastCall?.[0]).toMatchObject({ autoStartToken: 2 })
})


it('keeps the Mini opening claim through the console initial idle snapshot', () => {
  render(<FaroVoiceProvider><Accesses /></FaroVoiceProvider>)
  fireEvent(window, new CustomEvent(FARO_VOICE_ACTION_EVENT, { detail: 'open_and_listen' }))
  const props = panel.mock.lastCall?.[0] as { onSnapshotChange: (snapshot: { state: 'ready' }) => void }
  act(() => props.onSnapshotChange({ state: 'ready' }))
  fireEvent(window, new CustomEvent(FARO_VOICE_ACTION_EVENT, { detail: 'open_and_listen' }))
  expect(panel.mock.lastCall?.[0]).toMatchObject({ autoStartToken: 1 })
})
