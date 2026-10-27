import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'

const auth = vi.hoisted(() => ({ signOut: vi.fn() }))

vi.mock('../../hooks/auth', () => ({
  useAuth: () => auth,
}))

function renderSidebar(pathname: string, openGroups = {}, collapsed = false) {
  const onToggleGroup = vi.fn()
  const onToggleCollapsed = vi.fn()
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <Sidebar collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} openGroups={openGroups} onToggleGroup={onToggleGroup} />
    </MemoryRouter>,
  )
  return { onToggleGroup, onToggleCollapsed }
}

describe('Sidebar V2', () => {
  it('shows an explicitly opened active group and marks the active route', () => {
    renderSidebar('/finance', { personal: true })

    expect(screen.getByRole('button', { name: 'Personal' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Finanzas' })).toHaveClass('sidebar-child-link--active')
  })

  it('keeps labels visible in the compact persistent sidebar', () => {
    const { onToggleGroup } = renderSidebar('/dashboard')
    const personal = screen.getByRole('button', { name: 'Personal' })

    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ajustes' })).toBeInTheDocument()

    fireEvent.click(personal)

    expect(onToggleGroup).toHaveBeenCalledWith('personal')
    expect(screen.queryByRole('menu', { name: 'Personal: secciones' })).not.toBeInTheDocument()
  })

  it('keeps settings and sign out reachable from the persistent footer', () => {
    auth.signOut.mockReset()
    renderSidebar('/dashboard')

    expect(screen.getByRole('link', { name: 'Ajustes' })).toHaveAttribute('href', '/settings')
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(auth.signOut).toHaveBeenCalledOnce()
  })
  it('offers a collapse control with an accessible state', () => {
    const { onToggleCollapsed } = renderSidebar('/backlog')
    const toggle = screen.getByRole('button', { name: 'Contraer menú lateral' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(onToggleCollapsed).toHaveBeenCalledOnce()
  })

  it('keeps every available route directly reachable in the compact rail', () => {
    const { onToggleCollapsed } = renderSidebar('/backlog', {}, true)
    expect(screen.getByRole('link', { name: 'Backlog' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Backlog' })).toHaveClass('sidebar-rail-link--active')
    expect(screen.getByRole('link', { name: 'Finanzas' })).toHaveAttribute('href', '/finance')
    expect(screen.getByRole('link', { name: 'Calendario' })).toHaveAttribute('href', '/calendar')
    expect(screen.getByRole('link', { name: 'Ajustes' })).toHaveAttribute('href', '/settings')
    expect(screen.queryByRole('link', { name: 'Vault' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Calendario' }))
    expect(screen.getByRole('link', { name: 'Calendario' })).toHaveAttribute('aria-current', 'page')
    expect(onToggleCollapsed).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Expandir menú lateral' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows compact labels on hover and keyboard focus, and clears them on Escape', () => {
    renderSidebar('/backlog', {}, true)
    const finance = screen.getByRole('link', { name: 'Finanzas' })
    fireEvent.mouseOver(finance)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Finanzas')
    fireEvent.mouseLeave(screen.getByRole('complementary'))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.focus(finance)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Finanzas')
    fireEvent.keyDown(finance, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

})
