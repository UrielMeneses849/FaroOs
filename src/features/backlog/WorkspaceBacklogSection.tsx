import { Plus } from 'lucide-react'
import type { BacklogItem } from './backlogTypes'
import { BacklogItemRow } from './BacklogItemRow'

export function WorkspaceBacklogSection({ title, items, workspaceName, onAdd, onEdit, onDelete }: { title: string; items: BacklogItem[]; workspaceName: (item: BacklogItem) => string; onAdd?: () => void; onEdit: (item: BacklogItem) => void; onDelete: (item: BacklogItem) => void }) {
  return <section className="workspace-backlog-section"><header><h2>{title}</h2><span>{items.length}</span>{onAdd && <button onClick={onAdd}><Plus size={13} />Añadir</button>}</header>{items.length ? <div>{items.map((item) => <BacklogItemRow key={`${item.kind}:${item.id}`} item={item} workspace={workspaceName(item)} onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} />)}</div> : <p>Sin elementos en este estado.</p>}</section>
}
