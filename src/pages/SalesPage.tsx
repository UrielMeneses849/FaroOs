import { CircleDollarSign, Plus, Target, Trash2 } from 'lucide-react'
import { useCallback, useState, type DragEvent, type FormEvent } from 'react'
import { Button, EmptyState, Modal } from '../components/common'
import { PageHeader } from '../components/layout'
import { useRepositoryList } from '../hooks/useRepositoryList'
import { usePageCapture } from '../hooks/usePageCapture'
import { salesOpportunityRepository } from '../repositories/growthRepositories'
import type { Database } from '../types/database.types'

type Opportunity = Database['public']['Tables']['sales_opportunities']['Row']
const stages = [['new', 'Nuevo lead'], ['contacted', 'Contactado'], ['discovery', 'Descubrimiento'], ['proposal', 'Propuesta'], ['negotiation', 'Negociación'], ['won', 'Ganado'], ['lost', 'Perdido']] as const
const money = (value: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(value)

export function SalesPage() {
  const loader = useCallback((userId: string) => salesOpportunityRepository.list(userId), [])
  const { capture } = usePageCapture()
  const { data, loading, error, refresh, user } = useRepositoryList(loader)
  const [editing, setEditing] = useState<Opportunity>()
  const [feedback, setFeedback] = useState('')
  const active = data.filter((item) => !['won', 'lost'].includes(item.stage))
  const pipeline = active.reduce((sum, item) => sum + Number(item.estimated_value), 0)
  const proposals = data.filter((item) => item.stage === 'proposal').length
  const won = data.filter((item) => item.stage === 'won')
  const overdue = active.filter((item) => item.follow_up_date && item.follow_up_date < new Date().toISOString().slice(0, 10)).length
  const move = async (id: string, stage: Opportunity['stage']) => {
    if (!user) return
    const previous = data.find((item) => item.id === id); if (!previous || previous.stage === stage) return
    try { await salesOpportunityRepository.update(id, { stage }, user.id); await refresh(); setFeedback('Pipeline actualizado.') }
    catch { setFeedback('No se pudo mover. La oportunidad conserva su etapa anterior.') }
  }
  return <div className="page growth-page pipeline-page"><PageHeader eyebrow="Nexvora y actividad personal" title="Ventas" description="Qué oportunidades avanzan, cuánto valen y qué seguimiento vence." onCapture={capture} />
    <div className="growth-toolbar"><section className="growth-metrics growth-metrics--inline"><Metric label="Pipeline" value={money(pipeline)} /><Metric label="Activas" value={`${active.length}`} /><Metric label="Propuestas" value={`${proposals}`} /><Metric label="Ganado" value={money(won.reduce((sum, item) => sum + Number(item.estimated_value), 0))} /><Metric label="Conversión" value={data.length ? `${Math.round(won.length / data.length * 100)}%` : 'Sin datos'} /><Metric label="Vencidos" value={`${overdue}`} /></section><Button icon={<Plus size={15} />} onClick={() => setEditing(blankOpportunity())}>Nueva oportunidad</Button></div>
    {feedback && <div className="kanban-feedback" role="status">{feedback}</div>}
    {loading && !data.length ? <div className="planning-skeleton">Sincronizando pipeline…</div> : error ? <EmptyState title="No pudimos cargar Ventas" description={error} action={<Button onClick={refresh}>Reintentar</Button>} /> :
      <section className="growth-kanban">{stages.map(([stage, label]) => <div key={stage} className="growth-kanban__column" onDragOver={(event) => event.preventDefault()} onDrop={(event) => void move(event.dataTransfer.getData('text/opportunity'), stage)}><header><h2>{label}</h2><span>{data.filter((item) => item.stage === stage).length}</span></header><div>{data.filter((item) => item.stage === stage).map((item) => <article draggable key={item.id} onDragStart={(event: DragEvent) => event.dataTransfer.setData('text/opportunity', item.id)} onClick={() => setEditing(item)}><strong>{item.client}</strong><small>{item.company || item.service}</small><b>{money(Number(item.estimated_value))}</b>{item.next_action && <p>{item.next_action}</p>}{item.follow_up_date && <time className={item.follow_up_date < new Date().toISOString().slice(0, 10) ? 'overdue' : ''}>{item.follow_up_date}</time>}</article>)}</div></div>)}</section>}
    {editing && <OpportunityDialog item={editing} userId={user?.id} onClose={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); await refresh(); setFeedback('Oportunidad guardada.') }} />}
  </div>
}
function Metric({ label, value }: { label: string; value: string }) { return <article><Target /><span>{label}</span><strong>{value}</strong></article> }
function blankOpportunity(): Opportunity { const now = new Date().toISOString(); return { id: crypto.randomUUID(), user_id: '', lead_id: null, client: '', company: null, service: '', stage: 'new', estimated_value: 0, probability: null, next_action: null, follow_up_date: null, workspace_id: null, notes: null, sort_order: 0, created_at: now, updated_at: now } }
function OpportunityDialog({ item, userId, onClose, onSaved }: { item: Opportunity; userId?: string; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(item)
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!userId) return; await salesOpportunityRepository.save({ ...value, user_id: userId }, userId); onSaved() }
  return <Modal open title={item.client ? 'Editar oportunidad' : 'Nueva oportunidad'} onClose={onClose}><form className="growth-form" onSubmit={submit}><div><label>Cliente<input autoFocus required value={value.client} onChange={(event) => setValue({ ...value, client: event.target.value })} /></label><label>Empresa<input value={value.company ?? ''} onChange={(event) => setValue({ ...value, company: event.target.value })} /></label></div><label>Servicio<input required value={value.service} onChange={(event) => setValue({ ...value, service: event.target.value })} /></label><div><label>Valor estimado<input type="number" min="0" required value={value.estimated_value} onChange={(event) => setValue({ ...value, estimated_value: Number(event.target.value) })} /></label><label>Probabilidad<input type="number" min="0" max="100" value={value.probability ?? ''} onChange={(event) => setValue({ ...value, probability: event.target.value ? Number(event.target.value) : null })} /></label></div><label>Etapa<select value={value.stage} onChange={(event) => setValue({ ...value, stage: event.target.value as Opportunity['stage'] })}>{stages.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><div><label>Próxima acción<input value={value.next_action ?? ''} onChange={(event) => setValue({ ...value, next_action: event.target.value })} /></label><label>Seguimiento<input type="date" value={value.follow_up_date ?? ''} onChange={(event) => setValue({ ...value, follow_up_date: event.target.value || null })} /></label></div><label>Notas<textarea rows={4} value={value.notes ?? ''} onChange={(event) => setValue({ ...value, notes: event.target.value })} /></label><div className="modal-actions">{item.client && <Button type="button" variant="ghost" icon={<Trash2 size={14} />} onClick={async () => { if (!userId) return; await salesOpportunityRepository.remove(item.id, userId); onSaved() }}>Eliminar</Button>}<Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" icon={<CircleDollarSign size={14} />}>Guardar</Button></div></form></Modal>
}
