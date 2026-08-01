import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/auth'
import { AuthLoadingScreen } from './AuthLoadingScreen'

export function ProtectedRoute() {
  const { loading, session, user } = useAuth()
  const location = useLocation()

  if (loading) return <AuthLoadingScreen />

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  const isLab = user?.is_anonymous || user?.user_metadata?.faro_mode === 'ai_test_lab'
  if (isLab && location.pathname !== '/lab') {
    return <Navigate to="/lab" replace />
  }

  return <Outlet />
}
