import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { FaroVoiceProvider } from '../voice/FaroVoiceProvider'
import { QuickActionEntry } from './QuickActionEntry'

const mocks = vi.hoisted(() => ({ panel: vi.fn(), save: vi.fn() }))
vi.mock('../voice/VoicePanel', () => ({ VoicePanel: (props: unknown) => { mocks.panel(props); return null } }))
vi.mock('../planning/PlanningDialogs', () => ({ TaskFormDialog: ({ onClose }: { onClose: () => void }) => <section role="dialog" aria-label="Nueva tarea"><form onSubmit={event => { event.preventDefault(); mocks.save() }}><label>Título<input /></label><button type="button" onClick={onClose}>Cancelar</button><button type="submit">Guardar tarea</button></form></section> }))

function Shell() {
  const location = useLocation()
  const navigate = useNavigate()
  return <><QuickActionEntry key={location.pathname} /><output aria-label="Destino">{location.pathname}{location.search}{location.hash}</output><button onClick={() => navigate('/backlog?quick=task')}>Otro acceso</button></>
}
function show(entry: string, children?: ReactNode) {
  return render(<StrictMode><FaroVoiceProvider><MemoryRouter initialEntries={[entry]}><Routes><Route path="*" element={children ?? <Shell />} /></Routes></MemoryRouter></FaroVoiceProvider></StrictMode>)
}

describe('shortcut entry points', () => {
  it.each(['/backlog', '/today'])('opens a task draft at %s once and preserves the other query parameters', async route => {
    mocks.save.mockClear()
    show(`${route}?quick=task&workspace=personal#pendientes`)
    expect(await screen.findByRole('textbox', { name: 'Título' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Nueva tarea' })).toBeInTheDocument()
    expect(screen.getByLabelText('Destino')).toHaveTextContent(`${route}?quick=task&workspace=personal#pendientes`)
    expect(mocks.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByLabelText('Destino')).toHaveTextContent(`${route}?workspace=personal#pendientes`)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => {})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Otro acceso' }))
    expect(await screen.findByRole('textbox', { name: 'Título' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Nueva tarea' })).toBeInTheDocument()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('opens voice as an idle panel without activating listening', async () => {
    mocks.panel.mockClear()
    show('/dashboard?quick=voice')
    await waitFor(() => expect(mocks.panel.mock.lastCall?.[0]).toMatchObject({ open: true, presentation: 'modal', activateOnStart: false, autoStartToken: 0 }))
    expect(screen.getByLabelText('Destino')).toHaveTextContent('/dashboard')
    expect(mocks.panel.mock.calls.every(([props]) => !props.activateOnStart && props.autoStartToken === 0)).toBe(true)
  })
  it.each(['/finance?quick=movement', '/calendar?quick=event', '/dashboard?quick=unknown'])('leaves the existing route owner in control of %s', entry => {
    show(entry)
    expect(screen.getByLabelText('Destino')).toHaveTextContent(entry)
    expect(screen.queryByRole('dialog', { name: 'Nueva tarea' })).not.toBeInTheDocument()
  })
})
