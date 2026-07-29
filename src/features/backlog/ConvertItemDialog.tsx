import { CheckSquare, FolderKanban, Target } from 'lucide-react'
import { Button, Modal } from '../../components/common'
import type { BacklogItem } from './backlogTypes'

export function ConvertItemDialog({ item, onClose, onConvert }: { item: BacklogItem | null; onClose: () => void; onConvert: (target: 'task' | 'project' | 'goal') => void }) {
  return <Modal open={Boolean(item)} title="Convertir idea" onClose={onClose}><p className="modal-description">“{item?.title}” conservará su título, descripción, fecha de creación y relaciones compatibles.</p><div className="convert-options"><Button variant="secondary" icon={<CheckSquare />} onClick={() => onConvert('task')}>Convertir en tarea</Button><Button variant="secondary" icon={<FolderKanban />} onClick={() => onConvert('project')}>Convertir en proyecto</Button><Button variant="secondary" icon={<Target />} onClick={() => onConvert('goal')}>Convertir en objetivo</Button></div></Modal>
}
