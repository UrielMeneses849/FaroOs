import { StrictMode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { startSilentConcentration } from '../../features/computer/computerController'
import { FaroMini } from '../FaroMini'

const bridge = vi.hoisted(() => ({ request: vi.fn(), snapshot: vi.fn(), config: vi.fn(), hide: vi.fn() }))
const events = vi.hoisted(() => new Map<string, Set<(event: { payload: unknown }) => void>>())
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn((name: string, callback: (event: { payload: unknown }) => void) => {
  const group = events.get(name) ?? new Set(); group.add(callback); events.set(name, group)
  return Promise.resolve(() => { group.delete(callback) })
}) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn((command: string) => Promise.resolve(command === 'mini_preferences' ? { autoCollapse: true, reducedMotion: true } : command === 'mini_window_info' ? { zone: 'far', pressed: false, dragging: false, menuOpen: false } : undefined)) }))
vi.mock('../desktopBridge', () => ({ FARO_DESKTOP_VOICE_SNAPSHOT_EVENT: 'faro://voice-snapshot', getComputerConfig: bridge.config, getFaroDesktopVoiceSnapshot: bridge.snapshot, hideFaroMini: bridge.hide, requestFaroVoiceAction: bridge.request, showFaroMainWindow: vi.fn() }))
vi.mock('../../features/computer/computerController', () => ({ advanceTimedConcentration: vi.fn(), cancelSilentConcentration: vi.fn(), startSilentConcentration: vi.fn(), startSilentConcentrationBreak: vi.fn(), toggleSilentConcentrationPause: vi.fn() }))
const emit = async (name: string, payload: unknown) => { await act(async () => { events.get(name)?.forEach((callback) => callback({ payload })) }) }
beforeEach(() => { events.clear(); vi.clearAllMocks(); bridge.request.mockResolvedValue(undefined); bridge.config.mockResolvedValue(undefined); bridge.snapshot.mockResolvedValue({ state: 'ready' }) })

describe('Mini Voice Core integration', () => {
  it('keeps only one subscription per event under StrictMode and cleans all listeners', async () => {
    const { unmount } = render(<StrictMode><FaroMini /></StrictMode>)
    await waitFor(() => expect(events.get('faro://voice-snapshot')?.size).toBe(1))
    await waitFor(() => expect(events.get('faro://mini-pointer')?.size).toBe(1))
    expect(screen.queryByText('TRANSCRIPCIÓN')).not.toBeInTheDocument()
    unmount()
    await waitFor(() => expect([...events.values()].every((group) => group.size === 0)).toBe(true))
  })
  it('immediately shows listening on click and forwards the real confirmation once', async () => {
    const user = userEvent.setup()
    render(<FaroMini />)
    await waitFor(() => expect(bridge.snapshot).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Hablar con FARO' }))
    expect(screen.getByText('Abriendo micrófono…')).toBeInTheDocument()
    expect(screen.queryByText('Te escucho')).not.toBeInTheDocument()
    await emit('faro://voice-snapshot', { state: 'listening', inputStatus: 'active' })
    expect(screen.getByText('Te escucho')).toBeInTheDocument()
    expect(screen.getByText('Micrófono activo')).toBeInTheDocument()
    expect(bridge.request).toHaveBeenCalledWith('open_and_listen')
    await emit('faro://voice-snapshot', { state: 'awaiting_confirmation', pendingAction: { id: 'core-id', toolName: 'registerExpense', summary: '$180 · Comida', arguments: {} } })
    expect(screen.getByText('$180 · Comida')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.getByText('$180 · Comida')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(bridge.request.mock.calls.filter(([action]) => action === 'confirm')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
    await emit('faro://voice-snapshot', { state: 'executing' })
    expect(screen.getByText('Ejecutando…')).toBeInTheDocument()
    await emit('faro://voice-snapshot', { state: 'ready', feedback: 'Registrado' })
    expect(screen.getByText('Registrado')).toBeInTheDocument()
  })
  it('restores a real pending action, but not a stale speaking UI on remount', async () => {
    bridge.snapshot.mockResolvedValue({ state: 'speaking', feedback: 'Old response', transcript: 'Old transcript' })
    render(<FaroMini />)
    await waitFor(() => expect(bridge.snapshot).toHaveBeenCalled())
    expect(screen.queryByText('Old response')).not.toBeInTheDocument()
    expect(screen.queryByText('Old transcript')).not.toBeInTheDocument()
  })
})

it('starts concentration directly from Peek without opening voice', async () => {
  render(<FaroMini />)
  await waitFor(() => expect(bridge.snapshot).toHaveBeenCalled())
  await emit('faro://mini-action', 'restore')
  await userEvent.click(screen.getByRole('button', { name: 'Concentración' }))
  expect(startSilentConcentration).toHaveBeenCalledOnce()
  expect(bridge.request).not.toHaveBeenCalled()
})
