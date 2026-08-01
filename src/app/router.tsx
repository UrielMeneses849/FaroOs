import { Navigate, createBrowserRouter } from 'react-router-dom'
import { Suspense, type ReactNode } from 'react'
import { AppShell } from '../components/layout'
import { LoginPage, ProtectedRoute } from '../features/auth'
import { AiTestLabPage } from '../features/voice/AiTestLabPage'
import { RouteErrorPage } from '../features/errors/RouteErrorPage'
import { BacklogPage, CalendarPage, DashboardPage, FinancePage, GoalDetailPage, GoalsPage, HealthPage, JournalPage, SettingsPage, TodayPage } from './LazyPages'

const deferred = (page: ReactNode) => <Suspense fallback={<div className="route-loading" role="status">Cargando módulo…</div>}>{page}</Suspense>

export const router = createBrowserRouter(
  [
    { path: '/login', element: <LoginPage /> },
    {
      element: <ProtectedRoute />,
      children: [
        { path: '/lab', element: <AiTestLabPage /> },
        {
        path: '/',
        element: <AppShell />,
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: 'dashboard', element: deferred(<DashboardPage />) },
          { path: 'today', element: deferred(<TodayPage />) },
          { path: 'backlog', element: deferred(<BacklogPage />) },
          { path: 'goals', element: deferred(<GoalsPage />) },
          { path: 'goals/:goalId', element: deferred(<GoalDetailPage />) },
          { path: 'projects', element: <Navigate to="/goals" replace /> },
          { path: 'projects/:projectId', element: <Navigate to="/goals" replace /> },
          { path: 'calendar', element: deferred(<CalendarPage />) },
          { path: 'finance', element: deferred(<FinancePage />) },
          { path: 'health', element: deferred(<HealthPage />) },
          { path: 'journal', element: deferred(<JournalPage />) },
          { path: 'settings', element: deferred(<SettingsPage />) },
          // Módulos pausados: conservamos sus implementaciones, pero bloqueamos
          // el acceso directo hasta que vuelvan a ser útiles en FARO OS.
          { path: 'sprints', element: <Navigate to="/dashboard" replace /> },
          { path: 'nexvora', element: <Navigate to="/dashboard" replace /> },
          { path: 'portfolio', element: <Navigate to="/dashboard" replace /> },
          { path: 'sales', element: <Navigate to="/dashboard" replace /> },
          { path: 'content', element: <Navigate to="/dashboard" replace /> },
          { path: 'learning', element: <Navigate to="/dashboard" replace /> },
          { path: 'travel', element: <Navigate to="/dashboard" replace /> },
          { path: 'europe', element: <Navigate to="/dashboard" replace /> },
          { path: '*', element: <Navigate to="/dashboard" replace /> },
        ],
        },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
)
