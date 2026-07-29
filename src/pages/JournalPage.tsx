import { format, isValid, parseISO } from 'date-fns'
import { BookHeart, Eye, Pencil, Plus, Search, Sparkles, Trash2 } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Button, ConfirmDialog, EmptyState, Modal } from '../components/common'
import { PageHeader } from '../components/layout'
import { useJournal } from '../hooks/useJournal'
import { usePageCapture } from '../hooks/usePageCapture'
import type { JournalEntry } from '../types'

const faroTemplate = `¿Qué sentí hoy?\n\n¿Qué hice por mí?\n\n¿Qué construí?\n\n¿Qué aprendí?\n\n¿Qué necesito mañana?`
const blank = (): JournalEntry => {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), area: 'personal', title: '', content: '', occurredAt: now.slice(0, 10), mood: 7, tags: [], createdAt: now, updatedAt: now }
}

export function JournalPage() {
  const { capture } = usePageCapture()
  const { entries, loading, error, refresh, save, remove } = useJournal()
  const [query, setQuery] = useState('')
  const [reading, setReading] = useState<JournalEntry>()
  const [editing, setEditing] = useState<JournalEntry>()
  const [deleting, setDeleting] = useState<JournalEntry>()
  const [feedback, setFeedback] = useState('')
  const filtered = useMemo(() => entries.filter((entry) =>
    `${entry.title} ${entry.content} ${entry.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())),
  [entries, query])
  const openEditor = (entry?: JournalEntry, template = false) =>
    setEditing(entry ? { ...entry } : { ...blank(), content: template ? faroTemplate : '' })
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing || !editing.content.trim() || !editing.title.trim() || !isValid(parseISO(editing.occurredAt))) return
    const saved = await save({ ...editing, title: editing.title.trim(), content: editing.content.trim(), updatedAt: new Date().toISOString() })
    if (saved) { setEditing(undefined); setReading(saved); setFeedback('Entrada guardada en Supabase.') }
  }
  const readingIndex = reading ? filtered.findIndex((item) => item.id === reading.id) : -1
  return <div className="page tracker-page journal-page">
    <PageHeader eyebrow="Diario" title="Un lugar para escucharte." description="Escribe para comprender, recordar y seguir adelante." onCapture={capture} />
    <div className="journal-toolbar"><label><Search size={16} /><span className="sr-only">Buscar en diario</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por texto o tag…" /></label><Button variant="secondary" icon={<Sparkles size={14} />} onClick={() => openEditor(undefined, true)}>Plantilla FARO</Button><Button icon={<Plus size={15} />} onClick={() => openEditor()}>Nueva entrada</Button></div>
    {feedback && <div className="kanban-feedback" role="status">{feedback}<button onClick={() => setFeedback('')}>×</button></div>}
    {loading && !entries.length ? <div className="planning-skeleton">Sincronizando diario…</div>
      : error && !entries.length ? <EmptyState title="No pudimos cargar el diario" description={error} action={<Button onClick={refresh}>Reintentar</Button>} />
        : <section className="journal-list">{filtered.length ? filtered.map((entry) => <article className="journal-entry journal-entry--clickable" key={entry.id} onClick={() => setReading(entry)}><div className="journal-entry__date"><span>{format(parseISO(entry.occurredAt), 'dd')}</span><small>{format(parseISO(entry.occurredAt), 'MMM yyyy')}</small></div><div><div className="journal-entry__head"><h2>{entry.title}</h2>{entry.mood && <span>Ánimo {entry.mood}/10</span>}</div><p>{entry.content}</p><div className="journal-tags">{entry.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div></div><nav onClick={(event) => event.stopPropagation()}><button aria-label={`Visualizar ${entry.title}`} onClick={() => setReading(entry)}><Eye size={15} /></button><button aria-label={`Editar ${entry.title}`} onClick={() => openEditor(entry)}><Pencil size={15} /></button><button aria-label={`Eliminar ${entry.title}`} onClick={() => setDeleting(entry)}><Trash2 size={15} /></button></nav></article>) : <EmptyState title="No encontramos entradas" description={query ? 'Prueba con otra búsqueda.' : 'Escribe tu primera entrada cuando estés listo.'} action={!query ? <Button icon={<BookHeart size={15} />} onClick={() => openEditor()}>Comenzar</Button> : undefined} />}</section>}
    {reading && <Modal open title={reading.title} onClose={() => setReading(undefined)}><article className="journal-reader"><header><time>{format(parseISO(reading.occurredAt), 'dd MMMM yyyy')}</time>{reading.mood && <span>Ánimo {reading.mood}/10</span>}</header><div className="journal-reader__content">{reading.content}</div>{reading.gratitude && <aside><strong>Gratitud</strong><p>{reading.gratitude}</p></aside>}{reading.lesson && <aside><strong>Lección</strong><p>{reading.lesson}</p></aside>}<div className="journal-tags">{reading.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div><small>Creada {format(parseISO(reading.createdAt), 'dd/MM/yyyy HH:mm')} · Actualizada {format(parseISO(reading.updatedAt), 'dd/MM/yyyy HH:mm')}</small><footer><Button variant="ghost" disabled={readingIndex >= filtered.length - 1} onClick={() => setReading(filtered[readingIndex + 1])}>Anterior</Button><Button variant="ghost" disabled={readingIndex <= 0} onClick={() => setReading(filtered[readingIndex - 1])}>Siguiente</Button><Button icon={<Pencil size={14} />} onClick={() => { openEditor(reading); setReading(undefined) }}>Editar</Button><Button variant="ghost" onClick={() => setDeleting(reading)}>Eliminar</Button></footer></article></Modal>}
    {editing && (
      <Modal
        open
        panelClassName="journal-editor-modal"
        title={entries.some((item) => item.id === editing.id) ? 'Editar entrada' : 'Nueva entrada'}
        onClose={() => setEditing(undefined)}
      >
        <form className="journal-editor" onSubmit={submit}>
          <div className="journal-editor__meta">
            <label>
              <span>Fecha</span>
              <input type="date" required value={editing.occurredAt.slice(0, 10)} onChange={(event) => setEditing({ ...editing, occurredAt: event.target.value })} />
            </label>
            <label>
              <span>Ánimo</span>
              <input type="number" min="1" max="10" required value={editing.mood ?? 7} onChange={(event) => setEditing({ ...editing, mood: Number(event.target.value) })} />
            </label>
          </div>
          <label className="journal-editor__field">
            <span>Título</span>
            <input className="journal-editor__title" autoFocus required placeholder="Título de la entrada" value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} />
          </label>
          <label className="journal-editor__field">
            <span>Contenido</span>
            <textarea className="journal-editor__page" required placeholder="Escribe con calma…" value={editing.content} onChange={(event) => setEditing({ ...editing, content: event.target.value })} />
          </label>
          <small>{editing.content.trim() ? editing.content.trim().split(/\s+/).length : 0} palabras</small>
          <div className="journal-editor__secondary">
            <label>
              <span>Gratitud</span>
              <input value={editing.gratitude ?? ''} onChange={(event) => setEditing({ ...editing, gratitude: event.target.value || undefined })} />
            </label>
            <label>
              <span>Lección</span>
              <input value={editing.lesson ?? ''} onChange={(event) => setEditing({ ...editing, lesson: event.target.value || undefined })} />
            </label>
            <label className="journal-editor__tags-field">
              <span>Etiquetas <small>separadas por comas</small></span>
              <input value={editing.tags.join(', ')} onChange={(event) => setEditing({ ...editing, tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} />
            </label>
          </div>
          <div className="modal-actions">
            <Button type="button" variant="ghost" onClick={() => setEditing(undefined)}>Cancelar</Button>
            <Button type="submit">Guardar entrada</Button>
          </div>
        </form>
      </Modal>
    )}
    <ConfirmDialog open={Boolean(deleting)} title="Eliminar entrada" description="Esta acción elimina la entrada del diario de forma permanente." onClose={() => setDeleting(undefined)} onConfirm={async () => { if (!deleting) return; await remove(deleting.id); setDeleting(undefined); setReading(undefined); setFeedback('Entrada eliminada.') }} />
  </div>
}
