import type { BacklogKind } from '../../types'
import { useFaroStore } from '../../store'
import { useShallow } from 'zustand/react/shallow'

export function RelationshipPicker({ kind, projectId, goalId, onProject, onGoal }: { kind: BacklogKind; projectId?: string; goalId?: string; onProject: (id: string) => void; onGoal: (id: string) => void }) {
  const projects = useFaroStore(useShallow((state) => state.projects.filter((item) => !item.archivedAt)))
  const goals = useFaroStore(useShallow((state) => state.goals.filter((item) => !item.archivedAt)))
  return <div className="relationship-picker">
    {(kind === 'idea' || kind === 'task') && <label>Proyecto<select value={projectId ?? ''} onChange={(event) => onProject(event.target.value)}><option value="">Sin proyecto</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
    {kind !== 'goal' && <label>Objetivo<select value={goalId ?? ''} onChange={(event) => onGoal(event.target.value)}><option value="">Sin objetivo</option>{goals.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
  </div>
}
