import { useMemo } from 'react'
import { useFaroStore } from '../store'

export function useWorkspaceTasks(workspaceId?: string) {
  const tasks = useFaroStore((state) => state.tasks)
  return useMemo(() => tasks.filter((task) =>
    !task.archivedAt && (!workspaceId || task.workspaceId === workspaceId)), [tasks, workspaceId])
}
