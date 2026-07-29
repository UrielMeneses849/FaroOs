import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/auth'
import { AuthLoadingScreen } from './AuthLoadingScreen'

export function ProtectedRoute() {
  const { loading, session } = useAuth()
  const location = useLocation()

  if (loading) return <AuthLoadingScreen />

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}
