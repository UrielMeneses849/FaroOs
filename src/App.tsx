import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import { AuthProvider, GoalSyncProvider, LocalMigrationProvider, ProjectSyncProvider, TaskSyncProvider } from './providers'

export default function App() {
  return (
    <AuthProvider>
      <LocalMigrationProvider>
        <GoalSyncProvider>
          <ProjectSyncProvider>
            <TaskSyncProvider>
              <RouterProvider router={router} />
            </TaskSyncProvider>
          </ProjectSyncProvider>
        </GoalSyncProvider>
      </LocalMigrationProvider>
    </AuthProvider>
  )
}
