import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'

const auth = vi.hoisted(() => ({ signOut: vi.fn() }))

vi.mock('../../hooks/auth', () => ({
  useAuth: () => auth,
}))

function renderSidebar(pathname: string, openGroups = {}, collapsed = false, variant: 'default' | 'paper' = 'default') {
  const onToggleGroup = vi.fn()
  const onToggleCollapsed = vi.fn()
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <Sidebar variant={variant} collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} openGroups={openGroups} onToggleGroup={onToggleGroup} />
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

  it.each([
    ['default', false], ['default', true], ['paper', false], ['paper', true],
  ] as const)('omits Objetivos and Hoy from the %s sidebar with collapsed=%s', (variant, collapsed) => {
    renderSidebar('/finance', { personal: true, organization: true, faro: true }, collapsed, variant)
    expect(screen.queryByRole('link', { name: 'Objetivos', hidden: true })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Hoy', hidden: true })).not.toBeInTheDocument()
    const links = screen.getAllByRole('link', { hidden: true })
    expect(links.map(link => link.getAttribute('href'))).not.toContain('/goals')
    expect(links.map(link => link.getAttribute('href'))).not.toContain('/today')
    expect(screen.getByRole('link', { name: 'Finanzas' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Diario' })).toHaveAttribute('href', '/journal')
  })

  it('keeps keyboard access and rail tooltips working after the removed entries', async () => {
    const user = userEvent.setup()
    renderSidebar('/goals/existing-goal', {}, true, 'paper')
    screen.getByRole('link', { name: 'Necesidades' }).focus()
    await user.tab()
    expect(screen.getByRole('link', { name: 'FinOps' })).toHaveFocus()
    expect(screen.getByRole('tooltip')).toHaveTextContent('FinOps')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expandir menú lateral' })).toBeEnabled()
  })

})
