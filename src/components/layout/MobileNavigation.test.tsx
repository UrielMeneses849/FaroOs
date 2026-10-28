import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { MobileNavigation } from './MobileNavigation'

describe('MobileNavigation', () => {
  it('mantiene las cuatro rutas principales y abre el creador rápido', async () => {
    const user = userEvent.setup()
    const onQuick = vi.fn()
    render(<MemoryRouter initialEntries={['/calendar']}><MobileNavigation onQuick={onQuick} /></MemoryRouter>)

    expect(screen.getByRole('link', { name: /Inicio/ })).toHaveAttribute('href', '/dashboard')
    expect(screen.getByRole('link', { name: /Pendientes/ })).toHaveAttribute('href', '/backlog')
    expect(screen.getByRole('link', { name: /Calendario/ })).toHaveClass('mobile-nav__link--active')
    expect(screen.getByRole('link', { name: /Finanzas/ })).toHaveAttribute('href', '/finance')

    await user.click(screen.getByRole('button', { name: 'Crear nuevo' }))
    expect(onQuick).toHaveBeenCalledOnce()
  })
})
