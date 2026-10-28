import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopTopbar } from './DesktopTopbar'
import { useFaroStore } from '../../store/useFaroStore'

vi.mock('../../hooks/auth', () => ({ useAuth: () => ({ user: { email: 'faro@example.test' } }) }))
function Location() { const location = useLocation(); return <output aria-label="Destino">{location.pathname}{location.search}</output> }
const mount = (capture = vi.fn()) => render(<MemoryRouter><DesktopTopbar onCapture={capture} /><Location /></MemoryRouter>)

describe('Paper desktop search', () => {
  beforeEach(() => useFaroStore.setState({ goals: [] }))
  it('finds applications without accents and navigates when selected', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'Buscar en FARO…' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Buscar en FARO' }))
    await user.type(dialog.getByRole('textbox'), 'calendario')
    await user.click(dialog.getByRole('button', { name: 'Calendario' }))
    expect(screen.getByLabelText('Destino')).toHaveTextContent('/calendar')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
  it('keeps capture named when its responsive label is hidden', async () => {
    const user = userEvent.setup(), capture = vi.fn()
    mount(capture)
    const button = screen.getByRole('button', { name: 'Captura rápida' })
    within(button).getByText('Captura rápida').style.display = 'none'
    expect(screen.getByRole('button', { name: 'Captura rápida' })).toHaveAccessibleName('Captura rápida')
    await user.click(button)
    expect(capture).toHaveBeenCalledOnce()
  })
  it('opens the real movement action without creating records', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'Buscar en FARO…' }))
    await user.type(screen.getByRole('textbox'), 'movimiento')
    await user.click(screen.getByRole('button', { name: 'Registrar movimiento' }))
    expect(screen.getByLabelText('Destino')).toHaveTextContent('/finance?quick=movement')
  })
  it('offers capture and an honest empty state, and restores focus on Escape', async () => {
    const user = userEvent.setup(), capture = vi.fn()
    mount(capture)
    await user.click(screen.getByRole('button', { name: 'Captura rápida' }))
    expect(capture).toHaveBeenCalledOnce()
    const search = screen.getByRole('button', { name: 'Buscar en FARO…' })
    await user.click(search)
    await user.type(screen.getByRole('textbox'), 'zzzzzz')
    expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent('Sin resultados')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(search).toHaveFocus()
  })
})
