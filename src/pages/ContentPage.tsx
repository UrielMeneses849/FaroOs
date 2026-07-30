import { CalendarDays, Plus, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState, type DragEvent, type FormEvent } from 'react'
import { Button, EmptyState, Modal } from '../components/common'
import { PageHeader } from '../components/layout'
import { useRepositoryList } from '../hooks/useRepositoryList'
import { usePageCapture } from '../hooks/usePageCapture'
import { contentItemRepository } from '../repositories/growthRepositories'
import type { Database } from '../types/database.types'

type Item = Database['public']['Tables']['content_items']['Row']
const statuses = [['idea', 'Ideas'], ['research', 'Research'], ['draft', 'Borrador'], ['design', 'Diseño'], ['review', 'Revisión'], ['scheduled', 'Programado'], ['published', 'Publicado']] as const
const templates = ['LinkedIn', 'Caso de estudio', 'Reel', 'Carrusel', 'Artículo', 'Newsletter', 'Clase']

export function ContentPage() {
  const loader = useCallback((userId: string) => contentItemRepository.list(userId), [])
  const { capture } = usePageCapture()
  const { data, loading, error, refresh, user } = useRepositoryList(loader)
  const [editing, setEditing] = useState<Item>(), [view, setView] = useState<'kanban' | 'calendar'>('kanban')
  const [formatFilter, setFormatFilter] = useState('all'), [feedback, setFeedback] = useState('')
  const filtered = useMemo(() => data.filter((item) => formatFilter === 'all' || item.format === formatFilter), [data, formatFilter])
  const move = async (id: string, status: Item['status']) => {
    if (!user) return
    try { await contentItemRepository.update(id, { status }, user.id); await refresh(); setFeedback('Contenido actualizado.') }
    catch { setFeedback('No se pudo mover; se conservó el estado anterior.') }
  }
  return <div className="page growth-page pipeline-page"><PageHeader eyebrow="Sistema editorial" title="Contenido" description="Convierte ideas en activos publicados sin perder el hilo." onCapture={capture} />
    <div className="growth-toolbar"><div className="segmented"><button className={view === 'kanban' ? 'active' : ''} onClick={() => setView('kanban')}>Pipeline</button><button className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>Calendario editorial</button></div><select aria-label="Filtrar formato" value={formatFilter} onChange={(event) => setFormatFilter(event.target.value)}><option value="all">Todos los formatos</option>{templates.map((item) => <option key={item}>{item}</option>)}</select><Button icon={<Plus size={15} />} onClick={() => setEditing(blankItem())}>Nueva pieza</Button></div>
    {feedback && <div className="kanban-feedback" role="status">{feedback}</div>}
    {loading && !data.length ? <div className="planning-skeleton">Sincronizando contenido…</div> : error ? <EmptyState title="No pudimos cargar Contenido" description={error} action={<Button onClick={refresh}>Reintentar</Button>} /> :
      view === 'kanban' ? <section className="growth-kanban">{statuses.map(([status, label]) => <div key={status} className="growth-kanban__column" onDragOver={(event) => event.preventDefault()} onDrop={(event) => void move(event.dataTransfer.getData('text/content'), status)}><header><h2>{label}</h2><span>{filtered.filter((item) => item.status === status).length}</span></header><div>{filtered.filter((item) => item.status === status).map((item) => <article draggable key={item.id} onDragStart={(event: DragEvent) => event.dataTransfer.setData('text/content', item.id)} onClick={() => setEditing(item)}><strong>{item.title}</strong><small>{item.format}</small>{item.publish_at && <time>{new Date(item.publish_at).toLocaleDateString('es-MX')}</time>}</article>)}</div></div>)}</section>
        : <section className="editorial-list"><header><CalendarDays /><h2>Próximas publicaciones</h2></header>{filtered.filter((item) => item.publish_at).sort((a, b) => (a.publish_at ?? '').localeCompare(b.publish_at ?? '')).map((item) => <article key={item.id} onClick={() => setEditing(item)}><time>{new Date(item.publish_at!).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}</time><div><strong>{item.title}</strong><small>{item.format} · {item.status}</small></div></article>)}{!filtered.some((item) => item.publish_at) && <EmptyState title="Sin publicaciones programadas" description="Asigna una fecha a cualquier pieza para verla aquí." />}</section>}
    {editing && <ContentDialog item={editing} userId={user?.id} onClose={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); await refresh(); setFeedback('Contenido guardado.') }} />}
  </div>
}
function blankItem(): Item { const now = new Date().toISOString(); return { id: crypto.randomUUID(), user_id: '', title: '', idea: null, format: 'LinkedIn', channel_id: null, status: 'idea', objective: null, publish_at: null, workspace_id: null, campaign_id: null, cta: null, notes: null, portfolio_case_study_id: null, sort_order: 0, created_at: now, updated_at: now } }
function ContentDialog({ item, userId, onClose, onSaved }: { item: Item; userId?: string; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(item)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!userId) return
    await contentItemRepository.save({ ...value, user_id: userId }, userId)
    onSaved()
  }
  return <Modal open panelClassName="content-editor-modal" title={item.title ? 'Editar contenido' : 'Nueva pieza'} onClose={onClose}>
    <form className="growth-form content-editor-form" onSubmit={submit}>
      <label>Título<input autoFocus required value={value.title} onChange={(event) => setValue({ ...value, title: event.target.value })} /></label>
      <div><label>Formato<select value={value.format} onChange={(event) => setValue({ ...value, format: event.target.value })}>{templates.map((template) => <option key={template}>{template}</option>)}</select></label><label>Estado<select value={value.status} onChange={(event) => setValue({ ...value, status: event.target.value as Item['status'] })}>{statuses.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
      <label>Idea<textarea rows={4} value={value.idea ?? ''} onChange={(event) => setValue({ ...value, idea: event.target.value })} /></label>
      <label>Fecha de publicación<input type="datetime-local" value={value.publish_at?.slice(0, 16) ?? ''} onChange={(event) => setValue({ ...value, publish_at: event.target.value ? new Date(event.target.value).toISOString() : null })} /></label>
      <label>CTA<input value={value.cta ?? ''} onChange={(event) => setValue({ ...value, cta: event.target.value })} /></label>
      <label>Notas<textarea rows={3} value={value.notes ?? ''} onChange={(event) => setValue({ ...value, notes: event.target.value })} /></label>
      <div className="modal-actions">{item.title && <Button type="button" variant="ghost" icon={<Trash2 size={14} />} onClick={async () => { if (!userId) return; await contentItemRepository.remove(item.id, userId); onSaved() }}>Eliminar</Button>}<Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar</Button></div>
    </form>
  </Modal>
}
