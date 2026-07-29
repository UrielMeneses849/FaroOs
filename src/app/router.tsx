import { Navigate, createBrowserRouter } from 'react-router-dom'
import { Suspense, type ReactNode } from 'react'
import { Activity, Sparkles } from 'lucide-react'
import { AppShell } from '../components/layout'
import { LoginPage, ProtectedRoute } from '../features/auth'
import { ComingSoonPage } from '../pages/ComingSoonPage'
import { RouteErrorPage } from '../features/errors/RouteErrorPage'
import { BacklogPage, CalendarPage, ContentPage, DashboardPage, FinancePage, GoalDetailPage, GoalsPage, HealthPage, JournalPage, LearningPage, PortfolioPage, ProjectDetailPage, ProjectsPage, SalesPage, SettingsPage, SprintsPage, TodayPage, TravelPage } from './LazyPages'

const soon = (title: string, description: string, icon: typeof Activity) => <ComingSoonPage title={title} description={description} icon={icon} />
const deferred = (page: ReactNode) => <Suspense fallback={<div className="route-loading" role="status">Cargando módulo…</div>}>{page}</Suspense>

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [{
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
        { path: 'projects', element: deferred(<ProjectsPage />) },
        { path: 'projects/:projectId', element: deferred(<ProjectDetailPage />) },
        { path: 'sprints', element: deferred(<SprintsPage />) },
        { path: 'calendar', element: deferred(<CalendarPage />) },
        { path: 'nexvora', element: soon('Nexvora', 'Estrategia, operación y crecimiento en un solo lugar.', Sparkles) },
        { path: 'portfolio', element: deferred(<PortfolioPage />) },
        { path: 'learning', element: deferred(<LearningPage />) },
        { path: 'finance', element: deferred(<FinancePage />) },
        { path: 'sales', element: deferred(<SalesPage />) },
        { path: 'content', element: deferred(<ContentPage />) },
        { path: 'travel', element: deferred(<TravelPage />) },
        { path: 'europe', element: <Navigate to="/travel" replace /> },
        { path: 'health', element: deferred(<HealthPage />) },
        { path: 'journal', element: deferred(<JournalPage />) },
        { path: 'settings', element: deferred(<SettingsPage />) },
        { path: '*', element: <Navigate to="/dashboard" replace /> },
      ],
    }],
  },
])
