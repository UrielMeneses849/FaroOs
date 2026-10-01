import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'

const auth = vi.hoisted(() => ({ signOut: vi.fn() }))

vi.mock('../../hooks/auth', () => ({
  useAuth: () => auth,
}))

function renderSidebar(pathname: string, openGroups = {}) {
  const onToggleGroup = vi.fn()
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <Sidebar openGroups={openGroups} onToggleGroup={onToggleGroup} />
    </MemoryRouter>,
  )
  return { onToggleGroup }
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
})
