import { format, startOfMonth, startOfWeek } from 'date-fns'
import { BarChart3, BookOpen, Clock3, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button, EmptyState, Modal } from '../components/common'
import { PageHeader } from '../components/layout'
import { usePageCapture } from '../hooks/usePageCapture'
import { weeklySeries } from '../lib/personalMetrics'
import { useFaroStore } from '../store'

export function LearningPage() {
  const { capture } = usePageCapture()
  const sessions = useFaroStore((state) => state.studySessions)
  const create = useFaroStore((state) => state.createStudySession)
  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState('')
  const [skill, setSkill] = useState('')
  const [minutes, setMinutes] = useState('30')
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [notes, setNotes] = useState('')
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const monthStart = startOfMonth(new Date())
  const weekMinutes = sessions.filter((item) => new Date(item.occurredAt) >= weekStart).reduce((sum, item) => sum + item.durationMinutes, 0)
  const monthMinutes = sessions.filter((item) => new Date(item.occurredAt) >= monthStart).reduce((sum, item) => sum + item.durationMinutes, 0)
  const skills = Object.entries(sessions.reduce<Record<string, number>>((result, item) => ({ ...result, [item.skill]: (result[item.skill] ?? 0) + item.durationMinutes }), {})).sort(([, a], [, b]) => b - a).slice(0, 5)
  const series = weeklySeries({ ...useFaroStore.getState() })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!topic.trim() || !skill.trim()) return
    const timestamp = new Date().toISOString()
    create({ id: crypto.randomUUID(), topic: topic.trim(), skill: skill.trim(), durationMinutes: Math.max(1, Number(minutes)), occurredAt: `${date}T12:00:00`, notes: notes || undefined, area: 'learning', createdAt: timestamp, updatedAt: timestamp })
    setOpen(false); setTopic(''); setSkill(''); setNotes('')
  }
  return <div className="page tracker-page"><PageHeader eyebrow="Aprendizaje" title="Aprender con intención." description="Registra el tiempo que transforma curiosidad en capacidad." onCapture={capture} />
    <section className="tracker-metrics"><div><Clock3 /><span>Esta semana</span><strong>{weekMinutes} min</strong></div><div><BookOpen /><span>Este mes</span><strong>{(monthMinutes / 60).toFixed(1)} h</strong></div><div><BarChart3 /><span>Habilidades activas</span><strong>{skills.length}</strong></div><Button icon={<Plus size={15} />} onClick={() => setOpen(true)}>Registrar estudio</Button></section>
    <div className="tracker-grid"><section className="chart-panel"><div className="section-heading"><div><span className="eyebrow">Últimos 7 días</span><h2>Ritmo de estudio</h2></div></div>{series.some((item) => item.study > 0) ? <div className="chart-box" aria-label="Minutos de estudio por día"><ResponsiveContainer width="100%" height="100%"><BarChart data={series} accessibilityLayer><CartesianGrid stroke="#1d1d22" vertical={false} /><XAxis dataKey="date" stroke="#66666e" tickLine={false} axisLine={false} fontSize={9} /><YAxis stroke="#66666e" tickLine={false} axisLine={false} fontSize={9} /><Tooltip contentStyle={{ background: '#111114', border: '1px solid #303038', borderRadius: 8, fontSize: 10 }} /><Bar dataKey="study" name="Minutos" fill="#2457ff" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div> : <EmptyState title="Sin datos semanales" description="Registra una sesión para ver tu ritmo." />}</section>
      <section className="skills-panel"><div className="section-heading"><div><span className="eyebrow">Acumulado</span><h2>Habilidades principales</h2></div></div>{skills.map(([name, value]) => <div className="skill-row" key={name}><span>{name}</span><strong>{value} min</strong><i style={{ width: `${Math.min(100, value / (skills[0]?.[1] ?? 1) * 100)}%` }} /></div>)}</section></div>
    <section className="history-panel"><div className="section-heading"><div><span className="eyebrow">Historial</span><h2>Sesiones recientes</h2></div></div>{[...sessions].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map((item) => <article className="history-row" key={item.id}><div><strong>{item.topic}</strong><small>{item.skill}{item.notes ? ` · ${item.notes}` : ''}</small></div><span>{item.durationMinutes} min</span><time>{format(new Date(item.occurredAt), 'dd MMM')}</time></article>)}</section>
    {open && <Modal open title="Registrar aprendizaje" onClose={() => setOpen(false)}><form className="tracker-form" onSubmit={submit}><label>Tema<input autoFocus required value={topic} onChange={(event) => setTopic(event.target.value)} /></label><label>Habilidad<input required list="skills" value={skill} onChange={(event) => setSkill(event.target.value)} /><datalist id="skills"><option value="OpenAI API" /><option value="Prompt Engineering" /><option value="RAG" /><option value="React" /><option value="SEO" /><option value="Fotografía" /></datalist></label><div className="tracker-form__grid"><label>Minutos<input type="number" min="1" required value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label><label>Fecha<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label></div><label>Notas <span>opcional</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label><div className="modal-actions"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit">Guardar sesión</Button></div></form></Modal>}
  </div>
}
