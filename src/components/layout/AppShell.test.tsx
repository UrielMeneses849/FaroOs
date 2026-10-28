import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'
import { readSidebarPreferences } from './sidebarState'

vi.mock('../../hooks/auth', () => ({ useAuth: () => ({ signOut: vi.fn() }) }))
vi.mock('../../features/capture/QuickCaptureDialog', () => ({ QuickCaptureDialog: () => null }))
function Page() { return <h1>{useLocation().pathname}</h1> }
function renderShell() {
  return render(<MemoryRouter initialEntries={['/backlog']}><Routes><Route element={<AppShell />}><Route path="*" element={<Page />} /></Route></Routes></MemoryRouter>)
}

describe('shared sidebar layout', () => {
  it('keeps FARO navigation when entering Finance and opens the grouped app menu', async () => {
    const user = userEvent.setup()
    renderShell()
    const mobile = screen.getByRole('navigation', { name: 'Navegación móvil' })
    await user.click(within(mobile).getByRole('link', { name: 'Finanzas' }))
    expect(screen.getByRole('heading', { name: '/finance' })).toBeInTheDocument()
    expect(within(mobile).getByRole('link', { name: 'Finanzas' })).toHaveClass('mobile-nav__link--active')
    expect(within(mobile).getByRole('link', { name: 'Calendario' })).toHaveAttribute('href', '/calendar')
    await user.click(screen.getByRole('button', { name: 'Abrir menú' }))
    const apps = within(screen.getByRole('navigation', { name: 'Todas las secciones' }))
    expect(apps.getByRole('link', { name: 'Hoy' })).toHaveAttribute('href', '/today')
    expect(apps.getByRole('link', { name: 'Metas' })).toHaveAttribute('href', '/goals')
    await user.click(apps.getByRole('link', { name: 'Salud' }))
    expect(screen.getByRole('heading', { name: '/health' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Explorar FARO' })).not.toBeInTheDocument())
    expect(screen.getByRole('navigation', { name: 'Navegación móvil' })).toBeInTheDocument()
  })

  it('preserves compact mode when navigating and remounting, and restores group preferences when expanded', async () => {
    const user = userEvent.setup()
    const view = renderShell()
    await user.click(screen.getByRole('button', { name: 'FARO' }))
    await user.click(screen.getByRole('button', { name: 'Contraer menú lateral' }))
    expect(document.querySelector('.app-shell')).toHaveClass('app-shell--collapsed')
    expect(readSidebarPreferences()).toEqual({ collapsed: true, openGroups: { faro: true } })
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    await user.click(within(nav).getByRole('link', { name: 'Finanzas' }))
    expect(screen.getByRole('heading', { name: '/finance' })).toBeInTheDocument()
    expect(document.querySelector('.app-shell')).toHaveClass('app-shell--collapsed')
    view.unmount()
    renderShell()
    expect(document.querySelector('.app-shell')).toHaveClass('app-shell--collapsed')
    await user.click(screen.getByRole('button', { name: 'Expandir menú lateral' }))
    expect(document.querySelector('.app-shell')).toHaveClass('app-shell--expanded')
    expect(screen.getByRole('button', { name: 'FARO' })).toHaveAttribute('aria-expanded', 'true')
    expect(readSidebarPreferences()).toEqual({ collapsed: false, openGroups: { faro: true } })
  })
})
