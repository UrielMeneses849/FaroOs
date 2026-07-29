import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../../providers'
import type { AuthService } from '../../services'
import { useAuth } from '../../hooks/auth'
import { LoginPage } from './LoginPage'
import { ProtectedRoute } from './ProtectedRoute'

const storedSession = {
  access_token: 'test-access-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: 2_000_000_000,
  refresh_token: 'test-refresh-token',
  user: {
    id: 'user-1',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'uriel@example.com',
    created_at: '2026-07-24T00:00:00.000Z',
    app_metadata: {},
    user_metadata: {},
  },
} as Session

function createService(session: Session | null = null): AuthService {
  return {
    getSession: vi.fn().mockResolvedValue(session),
    subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
    signIn: vi.fn().mockResolvedValue({ error: null }),
    signUp: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  }
}

function SessionProbe() {
  const { loading, user, signOut } = useAuth()
  if (loading) return <p>Cargando</p>
  return (
    <div>
      <span>{user?.email ?? 'Sin sesión'}</span>
      <button type="button" onClick={() => void signOut()}>Salir</button>
    </div>
  )
}

describe('flujo de autenticación', () => {
  it('recupera la sesión persistida y permite cerrar sesión', async () => {
    const service = createService(storedSession)
    const user = userEvent.setup()

    render(
      <AuthProvider service={service}>
        <SessionProbe />
      </AuthProvider>,
    )

    expect(await screen.findByText('uriel@example.com')).toBeInTheDocument()
    expect(service.getSession).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Salir' }))
    expect(service.signOut).toHaveBeenCalledOnce()
  })

  it('redirige al login cuando no existe sesión', async () => {
    render(
      <AuthProvider service={createService()}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<p>Dashboard privado</p>} />
            </Route>
            <Route path="/login" element={<p>Acceso FARO</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    )

    expect(await screen.findByText('Acceso FARO')).toBeInTheDocument()
    expect(screen.queryByText('Dashboard privado')).not.toBeInTheDocument()
  })

  it('muestra contenido protegido con una sesión recuperada', async () => {
    render(
      <AuthProvider service={createService(storedSession)}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<p>Dashboard privado</p>} />
            </Route>
            <Route path="/login" element={<p>Acceso FARO</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    )

    expect(await screen.findByText('Dashboard privado')).toBeInTheDocument()
  })

  it('valida credenciales y ejecuta login y registro', async () => {
    const service = createService()
    const user = userEvent.setup()

    render(
      <AuthProvider service={service}>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<p>Destino</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    )

    await screen.findByRole('heading', { name: 'Vuelve a tu centro.' })
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(screen.getByText('Escribe un correo válido.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Correo'), 'uriel@example.com')
    await user.type(screen.getByLabelText('Contraseña'), 'segura123')
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }))

    await waitFor(() =>
      expect(service.signUp).toHaveBeenCalledWith({
        email: 'uriel@example.com',
        password: 'segura123',
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    await waitFor(() =>
      expect(service.signIn).toHaveBeenCalledWith({
        email: 'uriel@example.com',
        password: 'segura123',
      }),
    )
  })
})
