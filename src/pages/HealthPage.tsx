import { format, subDays } from 'date-fns'
import { es } from 'date-fns/locale'
import { Activity, Beef, Pencil, Plus, Scale, ShieldAlert, Target, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button, ConfirmDialog, EmptyState, Modal } from '../components/common'
import { PageHeader } from '../components/layout'
import { useHealthRecords } from '../hooks/useHealthRecords'
import { weightGoalProgress, weightProjectionSeries } from '../lib/healthAnalytics'
import { useFaroStore } from '../store'
import type { HealthLog } from '../types'

const targetStorageKey = 'faro-health-weight-target'
const targetDateStorageKey = 'faro-health-weight-target-date'
const foodLabels = { good: 'Bien', okay: 'Más o menos', bad: 'Mal' } as const
const progressLabels = {
  insufficient: ['Datos insuficientes', 'Registra al menos 3 mediciones para calcular una tendencia.'],
  ahead: ['Adelantado', 'Tu ritmo reciente supera el necesario para llegar a tiempo.'],
  on_track: ['En ritmo', 'Tu ritmo reciente es consistente con la fecha objetivo.'],
  attention: ['Requiere atención', 'Estás avanzando, pero necesitas acercarte un poco más al ritmo requerido.'],
  off_track: ['Fuera de ritmo', 'El ritmo reciente no alcanza todavía el necesario para la fecha elegida.'],
  achieved: ['Meta alcanzada', 'Llegaste a tu peso objetivo.'],
} as const

export function HealthPage() {
  const { logs, loading, error, refresh, save: saveHealth, remove: removeHealth } = useHealthRecords()
  const treatments = useFaroStore((state) => state.treatmentLogs)
  const createTreatment = useFaroStore((state) => state.createTreatmentLog)
  const [healthOpen, setHealthOpen] = useState(false)
  const [editingHealth, setEditingHealth] = useState<HealthLog>()
  const [deletingHealth, setDeletingHealth] = useState<HealthLog>()
  const [treatmentOpen, setTreatmentOpen] = useState(false)
  const [targetOpen, setTargetOpen] = useState(false)
  const [targetKg, setTargetKg] = useState(() => Number(localStorage.getItem(targetStorageKey)) || 70)
  const [targetDate, setTargetDate] = useState(() => localStorage.getItem(targetDateStorageKey) || `${new Date().getFullYear()}-12-31`)
  const [operationError, setOperationError] = useState('')
  const [activeTab, setActiveTab] = useState<'progress' | 'history' | 'treatment'>('progress')
  const recent = logs.filter((item) => new Date(`${item.occurredAt.slice(0, 10)}T12:00:00`) >= subDays(new Date(), 29))
  const progress = weightGoalProgress(logs, targetKg, new Date(`${targetDate}T12:00:00`))
  const weightSeries = weightProjectionSeries(logs, new Date(`${targetDate}T12:00:00`)).map((item) => ({ ...item, label: format(new Date(`${item.date}T12:00:00`), 'dd MMM') }))
  const [progressTitle, progressCopy] = progressLabels[progress.status]
  const trainedDays = recent.filter((item) => (item.trainingMinutes ?? 0) > 0).length
  const foodLoggedDays = recent.filter((item) => item.foodQuality != null).length

  return <div className="page tracker-page health-focus">
    <PageHeader eyebrow={format(new Date(), "EEEE, d 'de' MMMM", { locale: es })} title="Peso, hábitos y dirección." description="Tres señales simples para observar tu avance sin ruido." />
    {(error || operationError) && <div className="health-sync-notice" role="alert"><span><strong>La sincronización necesita atención.</strong>{operationError || error} Tu respaldo local permanece en este dispositivo.</span><Button variant="secondary" onClick={() => { setOperationError(''); void refresh() }}>Reintentar</Button></div>}
    {loading && <div className="health-sync-state" role="status">Sincronizando tus registros de salud…</div>}
    <nav className="health-tabs" aria-label="Secciones de salud">
      {([['progress', 'Progreso'], ['history', 'Historial'], ['treatment', 'Isotretinoína']] as const).map(([id, label]) => <button key={id} className={activeTab === id ? 'active' : ''} aria-current={activeTab === id ? 'page' : undefined} onClick={() => setActiveTab(id)}>{label}</button>)}
    </nav>
    <div className="health-tab-content">
      {activeTab === 'progress' && <div className="health-tab-panel health-tab-panel--progress">
        <section className="health-focus__metrics">
          <article className="featured"><Scale /><span>Peso actual</span><strong>{progress.currentKg ? `${progress.currentKg.toFixed(1)} kg` : 'Sin registro'}</strong><small>Último peso capturado</small></article>
          <article><Target /><span>Meta · {targetDate}</span><strong>{targetKg.toFixed(1)} kg</strong><button onClick={() => setTargetOpen(true)}>Modificar meta</button></article>
          <article><Activity /><span>Entrenamiento · 30 días</span><strong>{trainedDays} días</strong><small>{recent.length ? `${Math.round(trainedDays / recent.length * 100)}% de tus registros` : 'Sin registros'}</small></article>
          <article><Beef /><span>Alimentación registrada · 30 días</span><strong>{foodLoggedDays} días</strong><small>{recent.length ? `${Math.round(foodLoggedDays / recent.length * 100)}% de tus registros` : 'Sin registros'}</small></article>
          <Button icon={<Plus size={15} />} onClick={() => setHealthOpen(true)}>Registrar hoy</Button>
        </section>
        <div className="health-focus__grid">
          <section className="health-weight-chart">
            <header><div><span className="eyebrow">Historial de peso</span><h2>Tu trayectoria</h2></div><strong>{progress.recentWeeklyKg == null ? '—' : `${progress.recentWeeklyKg > 0 ? '+' : ''}${progress.recentWeeklyKg} kg/sem`}</strong></header>
            {weightSeries.length ? <div className="chart-box chart-box--tall" aria-label="Peso real y proyección"><ResponsiveContainer width="100%" height="100%"><LineChart data={weightSeries} accessibilityLayer><CartesianGrid stroke="#1d1d22" vertical={false} /><XAxis dataKey="label" stroke="#777780" tickLine={false} axisLine={false} fontSize={10} minTickGap={28} /><YAxis domain={['dataMin - 1', 'dataMax + 1']} stroke="#777780" tickLine={false} axisLine={false} fontSize={10} width={42} /><Tooltip formatter={(value, name) => [`${Number(value).toFixed(1)} kg`, name === 'actual' ? 'Peso real' : 'Proyección']} contentStyle={{ background: '#111114', border: '1px solid #303038', borderRadius: 8 }} /><ReferenceLine y={targetKg} stroke="#35c78a" strokeDasharray="4 4" label={{ value: 'Meta', fill: '#35c78a', fontSize: 10 }} /><ReferenceLine x={format(new Date(`${targetDate}T12:00:00`), 'dd MMM')} stroke="#a970ff" strokeDasharray="3 5" label={{ value: 'Fecha objetivo', fill: '#a970ff', fontSize: 9 }} />{progress.estimatedCompletionDate && <ReferenceLine x={format(new Date(`${progress.estimatedCompletionDate}T12:00:00`), 'dd MMM')} stroke="#f4b740" strokeDasharray="2 5" />}<Line type="monotone" dataKey="actual" stroke="#315de3" strokeWidth={3} dot={{ r: 3 }} connectNulls={false} /><Line type="monotone" dataKey="projected" stroke="#6f8df3" strokeWidth={2} strokeDasharray="6 5" dot={false} connectNulls /></LineChart></ResponsiveContainer></div> : <EmptyState title="Sin pesos todavía" description="Registra tu peso para comenzar a observar la tendencia." />}
            {progress.measurements < 3 && weightSeries.length > 0 && <p className="health-projection-empty">Registra al menos tres pesos en 30 días para mostrar la proyección.</p>}
          </section>
          <section className={`health-forecast health-forecast--${progress.status}`}><span className="eyebrow">Progreso hacia tu meta</span><h2>{progressTitle}</h2><p>{progressCopy}</p><dl className="health-progress-list"><div><dt>Peso actual</dt><dd>{progress.currentKg ? `${progress.currentKg.toFixed(1)} kg` : '—'}</dd></div><div><dt>Peso objetivo</dt><dd>{targetKg.toFixed(1)} kg</dd></div><div><dt>Kilos restantes</dt><dd>{progress.remainingKg == null ? '—' : `${progress.remainingKg.toFixed(1)} kg`}</dd></div><div><dt>Tiempo restante</dt><dd>{progress.daysRemaining} días</dd></div><div><dt>Ritmo necesario / mes</dt><dd>{progress.requiredMonthlyKg == null ? '—' : `${progress.requiredMonthlyKg} kg`}</dd></div><div><dt>Ritmo necesario / semana</dt><dd>{progress.requiredWeeklyKg == null ? '—' : `${progress.requiredWeeklyKg} kg`}</dd></div><div><dt>Ritmo reciente real</dt><dd>{progress.recentWeeklyKg == null ? '—' : `${progress.recentWeeklyKg > 0 ? '+' : ''}${progress.recentWeeklyKg} kg/sem`}</dd></div><div><dt>Fecha estimada</dt><dd>{progress.estimatedCompletionDate ?? '—'}</dd></div></dl><em>Regresión lineal de los últimos 30 días. Estimación informativa, no recomendación médica.</em></section>
        </div>
      </div>}
      {activeTab === 'history' && <div className="health-tab-panel health-tab-panel--scroll"><section className="health-history"><header><span className="eyebrow">Historial</span><h2>Registros recientes</h2></header>{[...logs].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 20).map((item) => <article key={item.id}><time>{item.occurredAt.slice(0, 10)}</time><strong>{item.weightKg ? `${item.weightKg} kg` : 'Sin peso'}</strong><span>{item.foodQuality ? `Comida: ${foodLabels[item.foodQuality]}` : 'Comida sin evaluar'}</span><span>{(item.trainingMinutes ?? 0) > 0 ? 'Sí entrené' : 'No entrené'}</span><nav><button aria-label={`Editar registro del ${item.occurredAt.slice(0, 10)}`} title="Editar" onClick={() => setEditingHealth(item)}><Pencil size={15} /></button><button aria-label={`Eliminar registro del ${item.occurredAt.slice(0, 10)}`} title="Eliminar" onClick={() => setDeletingHealth(item)}><Trash2 size={15} /></button></nav></article>)}</section></div>}
      {activeTab === 'treatment' && <div className="health-tab-panel health-tab-panel--scroll"><section className="treatment-panel"><div className="treatment-panel__copy"><ShieldAlert /><div><span className="eyebrow">Subsección separada</span><h2>Isotretinoína</h2><p>Este registro es informativo y no sustituye las indicaciones de tu dermatólogo.</p></div></div><Button variant="secondary" icon={<Plus size={14} />} onClick={() => setTreatmentOpen(true)}>Registrar tratamiento</Button>{treatments.length > 0 && <div className="treatment-history">{[...treatments].reverse().slice(0, 5).map((item) => <article key={item.id}><strong>{item.occurredAt.slice(0, 10)}</strong><span>{item.medicationTaken ? 'Medicamento registrado' : 'No tomado'}{item.dosage ? ` · ${item.dosage}` : ''}</span><small>{item.skinCondition || 'Sin nota de piel'}{item.sideEffects ? ` · ${item.sideEffects}` : ''}</small></article>)}</div>}</section></div>}
    </div>
    {healthOpen && <HealthLogDialog onClose={() => setHealthOpen(false)} onSave={saveHealth} />}
    {editingHealth && <HealthLogDialog entry={editingHealth} onClose={() => setEditingHealth(undefined)} onSave={saveHealth} />}
    {targetOpen && <WeightTargetDialog value={targetKg} date={targetDate} onClose={() => setTargetOpen(false)} onSave={(value, date) => { localStorage.setItem(targetStorageKey, String(value)); localStorage.setItem(targetDateStorageKey, date); setTargetKg(value); setTargetDate(date); setTargetOpen(false) }} />}
    {treatmentOpen && <TreatmentDialog onClose={() => setTreatmentOpen(false)} onSave={createTreatment} />}
    <ConfirmDialog open={Boolean(deletingHealth)} title="Eliminar registro de salud" description={deletingHealth ? `Se eliminará permanentemente el registro del ${deletingHealth.occurredAt.slice(0, 10)} en Supabase y en el respaldo local. La gráfica y la proyección se actualizarán inmediatamente.` : ''} onClose={() => setDeletingHealth(undefined)} onConfirm={async () => { if (!deletingHealth) return; try { await removeHealth(deletingHealth.id); setDeletingHealth(undefined); setOperationError('') } catch (reason) { setOperationError(reason instanceof Error ? reason.message : 'No se pudo eliminar el registro.'); setDeletingHealth(undefined) } }} />
  </div>
}

function HealthLogDialog({ entry, onClose, onSave }: { entry?: HealthLog; onClose: () => void; onSave: (log: HealthLog) => Promise<HealthLog> }) {
  const [date, setDate] = useState(entry?.occurredAt.slice(0, 10) ?? format(new Date(), 'yyyy-MM-dd'))
  const [weight, setWeight] = useState(entry?.weightKg ? String(entry.weightKg) : '')
  const [foodQuality, setFoodQuality] = useState<'good' | 'okay' | 'bad'>(entry?.foodQuality ?? 'good')
  const [trained, setTrained] = useState((entry?.trainingMinutes ?? 0) > 0)
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const timestamp = new Date().toISOString()
    setSaving(true); setError('')
    try {
      await onSave({ ...entry, id: entry?.id ?? crypto.randomUUID(), area: 'health', occurredAt: date, energy: entry?.energy ?? 7, foodQuality, weightKg: weight ? Number(weight) : undefined, trainingMinutes: trained ? 1 : 0, movementMinutes: trained ? 1 : 0, notes: notes || undefined, createdAt: entry?.createdAt ?? timestamp, updatedAt: timestamp })
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar en Supabase. El formulario sigue abierto para que no pierdas la captura.')
    } finally { setSaving(false) }
  }
  return <Modal open title={entry ? 'Editar registro' : 'Registro de hoy'} onClose={onClose}><form className="tracker-form health-log-form" onSubmit={submit}><label>Fecha<input autoFocus type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Peso (kg)<input type="number" min="20" max="400" step=".1" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="Ej. 72.4" /></label><fieldset><legend>¿Qué tal comí hoy?</legend><div className="health-choice" role="group" aria-label="Calidad de alimentación">{(['good', 'okay', 'bad'] as const).map((value) => <button key={value} type="button" aria-pressed={foodQuality === value} className={foodQuality === value ? 'active' : ''} onClick={() => setFoodQuality(value)}>{foodLabels[value]}</button>)}</div></fieldset><label className="health-trained"><input type="checkbox" checked={trained} onChange={(event) => setTrained(event.target.checked)} /><span>Entrené hoy</span></label><label>Nota <span>opcional</span><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar registro'}</Button></div></form></Modal>
}

function WeightTargetDialog({ value, date, onClose, onSave }: { value: number; date: string; onClose: () => void; onSave: (value: number, date: string) => void }) {
  const [target, setTarget] = useState(String(value))
  const [targetDate, setTargetDate] = useState(date)
  return <Modal open title="Meta de peso" onClose={onClose}><form className="tracker-form" onSubmit={(event) => { event.preventDefault(); const parsed = Number(target); if (parsed > 20 && parsed < 400 && targetDate) onSave(parsed, targetDate) }}><label>Peso objetivo<input autoFocus type="number" min="20" max="400" step=".1" required value={target} onChange={(event) => setTarget(event.target.value)} /></label><label>Fecha objetivo<input type="date" required value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label><p className="medical-notice">Esta meta es personal e informativa. Ajusta cualquier objetivo de salud con un profesional cuando corresponda.</p><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar meta</Button></div></form></Modal>
}

function TreatmentDialog({ onClose, onSave }: { onClose: () => void; onSave: ReturnType<typeof useFaroStore.getState>['createTreatmentLog'] }) {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd')); const [taken, setTaken] = useState(true); const [dosage, setDosage] = useState(''); const [dryness, setDryness] = useState(''); const [skin, setSkin] = useState(''); const [effects, setEffects] = useState(''); const [notes, setNotes] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); const timestamp = new Date().toISOString(); onSave({ id: crypto.randomUUID(), area: 'health', treatment: 'isotretinoin', occurredAt: date, medicationTaken: taken, dosage: dosage || undefined, dryness: dryness ? Number(dryness) : undefined, skinCondition: skin || undefined, sideEffects: effects || undefined, notes: notes || undefined, createdAt: timestamp, updatedAt: timestamp }); onClose() }
  return <Modal open title="Registro de isotretinoína" onClose={onClose}><form className="tracker-form" onSubmit={submit}><div className="medical-notice">Este registro es informativo y no sustituye las indicaciones de tu dermatólogo.</div><label>Fecha<input autoFocus type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="check-label"><input type="checkbox" checked={taken} onChange={(event) => setTaken(event.target.checked)} /> Medicamento tomado</label><label>Dosis escrita por ti <span>opcional</span><input value={dosage} onChange={(event) => setDosage(event.target.value)} placeholder="Sólo registra la indicación recibida" /></label><div className="tracker-form__grid"><label>Resequedad 1–10<input type="number" min="1" max="10" value={dryness} onChange={(event) => setDryness(event.target.value)} /></label><label>Estado de piel<input value={skin} onChange={(event) => setSkin(event.target.value)} /></label></div><label>Efectos secundarios <span>opcional</span><input value={effects} onChange={(event) => setEffects(event.target.value)} /></label><label>Notas <span>opcional</span><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar registro</Button></div></form></Modal>
}
