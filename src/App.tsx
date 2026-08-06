import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import { AuthProvider, GoalSyncProvider, LocalMigrationProvider, ProjectSyncProvider, TaskSyncProvider } from './providers'
import { useAuth } from './hooks/auth'
import { FaroVoiceProvider } from './features/voice/FaroVoiceProvider'

function FaroRuntime() {
  const { user } = useAuth()
  const isLab = user?.is_anonymous || user?.user_metadata?.faro_mode === 'ai_test_lab'

  if (isLab) return <RouterProvider router={router} />

  return (
    <LocalMigrationProvider>
      <GoalSyncProvider>
        <ProjectSyncProvider>
          <TaskSyncProvider>
            <FaroVoiceProvider><RouterProvider router={router} /></FaroVoiceProvider>
          </TaskSyncProvider>
        </ProjectSyncProvider>
      </GoalSyncProvider>
    </LocalMigrationProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <FaroRuntime />
    </AuthProvider>
  )
}
