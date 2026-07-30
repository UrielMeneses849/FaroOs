import { format, subDays } from 'date-fns'
import { Activity, Beef, Pencil, Plus, Scale, ShieldAlert, Target, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button, ConfirmDialog, EmptyState, Modal } from '../components/common'
import { PageHeader } from '../components/layout'
import { usePageCapture } from '../hooks/usePageCapture'
import { forecastWeight } from '../lib/healthAnalytics'
import { useFaroStore } from '../store'
import type { HealthLog } from '../types'

const targetStorageKey = 'faro-health-weight-target'
const foodLabels = { good: 'Bien', okay: 'Más o menos', bad: 'Mal' } as const
const forecastLabels = {
  positive: ['Positiva', 'Tu trayectoria se acerca a la meta.'],
  regular: ['Regular', 'La tendencia es estable; todavía puede cambiar con más registros.'],
  negative: ['Negativa', 'La trayectoria actual se aleja de la meta. Úsala para observar, no para diagnosticar.'],
  insufficient: ['Aprendiendo', 'Necesito al menos tres registros de peso para estimar una tendencia.'],
} as const

export function HealthPage() {
  const { capture } = usePageCapture()
  const storedLogs = useFaroStore((state) => state.healthLogs)
  const logs = storedLogs.filter((item) => !/^health-\d+$/.test(item.id))
  const treatments = useFaroStore((state) => state.treatmentLogs)
  const createHealth = useFaroStore((state) => state.createHealthLog)
  const updateHealth = useFaroStore((state) => state.updateHealthLog)
  const deleteHealth = useFaroStore((state) => state.deleteHealthLog)
  const createTreatment = useFaroStore((state) => state.createTreatmentLog)
  const [healthOpen, setHealthOpen] = useState(false)
  const [editingHealth, setEditingHealth] = useState<HealthLog>()
  const [deletingHealth, setDeletingHealth] = useState<HealthLog>()
  const [treatmentOpen, setTreatmentOpen] = useState(false)
  const [targetOpen, setTargetOpen] = useState(false)
  const [targetKg, setTargetKg] = useState(() => Number(localStorage.getItem(targetStorageKey)) || 70)
  const recent = logs.filter((item) => new Date(`${item.occurredAt.slice(0, 10)}T12:00:00`) >= subDays(new Date(), 29))
  const weights = [...logs]
    .filter((item) => item.weightKg != null)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .slice(-24)
    .map((item) => ({ date: format(new Date(`${item.occurredAt.slice(0, 10)}T12:00:00`), 'dd MMM'), weight: item.weightKg }))
  const forecast = forecastWeight(logs, targetKg)
  const [forecastTitle, forecastCopy] = forecastLabels[forecast.status]
  const trainedDays = recent.filter((item) => (item.trainingMinutes ?? 0) > 0).length
  const goodFoodDays = recent.filter((item) => item.foodQuality === 'good').length

  return <div className="page tracker-page health-focus">
    <PageHeader eyebrow="Salud" title="Peso, hábitos y dirección." description="Tres señales simples para observar tu avance sin ruido." onCapture={capture} />
    <section className="health-focus__metrics">
      <article className="featured"><Scale /><span>Peso actual</span><strong>{forecast.currentKg ? `${forecast.currentKg.toFixed(1)} kg` : 'Sin registro'}</strong><small>Último peso capturado</small></article>
      <article><Target /><span>Meta al 31 de diciembre</span><strong>{targetKg.toFixed(1)} kg</strong><button onClick={() => setTargetOpen(true)}>Modificar meta</button></article>
      <article><Activity /><span>Entrenamiento · 30 días</span><strong>{trainedDays} días</strong><small>{recent.length ? `${Math.round(trainedDays / recent.length * 100)}% de tus registros` : 'Sin registros'}</small></article>
      <article><Beef /><span>Comí bien · 30 días</span><strong>{goodFoodDays} días</strong><small>{recent.length ? `${Math.round(goodFoodDays / recent.length * 100)}% de tus registros` : 'Sin registros'}</small></article>
      <Button icon={<Plus size={15} />} onClick={() => setHealthOpen(true)}>Registrar hoy</Button>
    </section>

    <div className="health-focus__grid">
      <section className="health-weight-chart">
        <header><div><span className="eyebrow">Historial de peso</span><h2>Tu trayectoria</h2></div><strong>{forecast.weeklyChangeKg == null ? '—' : `${forecast.weeklyChangeKg > 0 ? '+' : ''}${forecast.weeklyChangeKg} kg/sem`}</strong></header>
        {weights.length ? <div className="chart-box chart-box--tall" aria-label="Historial de peso"><ResponsiveContainer width="100%" height="100%"><BarChart data={weights} accessibilityLayer><CartesianGrid stroke="#1d1d22" vertical={false} /><XAxis dataKey="date" stroke="#777780" tickLine={false} axisLine={false} fontSize={10} /><YAxis domain={['dataMin - 1', 'dataMax + 1']} stroke="#777780" tickLine={false} axisLine={false} fontSize={10} width={38} /><Tooltip formatter={(value) => [`${Number(value).toFixed(1)} kg`, 'Peso']} contentStyle={{ background: '#111114', border: '1px solid #303038', borderRadius: 8 }} /><ReferenceLine y={targetKg} stroke="#35c78a" strokeDasharray="4 4" label={{ value: 'Meta', fill: '#35c78a', fontSize: 10 }} /><Bar dataKey="weight" fill="#315de3" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div> : <EmptyState title="Sin pesos todavía" description="Registra tu peso para comenzar a observar la tendencia." />}
      </section>
      <section className={`health-forecast health-forecast--${forecast.status}`}>
        <span className="eyebrow">Proyección local</span><h2>{forecastTitle}</h2>
        <strong>{forecast.projectedKg ? `${forecast.projectedKg.toFixed(1)} kg` : 'Aún sin proyección'}</strong>
        <p>{forecastCopy}</p>
        {forecast.remainingKg != null && <small>Distancia actual a la meta: {Math.abs(forecast.remainingKg).toFixed(1)} kg.</small>}
        <em>Estimación estadística basada únicamente en tus registros. No es una recomendación médica.</em>
      </section>
    </div>

    <section className="health-history"><header><span className="eyebrow">Historial</span><h2>Registros recientes</h2></header>{[...logs].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 20).map((item) => <article key={item.id}><time>{item.occurredAt.slice(0, 10)}</time><strong>{item.weightKg ? `${item.weightKg} kg` : 'Sin peso'}</strong><span>{item.foodQuality ? `Comida: ${foodLabels[item.foodQuality]}` : 'Comida sin evaluar'}</span><span>{(item.trainingMinutes ?? 0) > 0 ? 'Sí entrené' : 'No entrené'}</span><nav><button aria-label={`Editar registro del ${item.occurredAt.slice(0, 10)}`} title="Editar" onClick={() => setEditingHealth(item)}><Pencil size={15} /></button><button aria-label={`Eliminar registro del ${item.occurredAt.slice(0, 10)}`} title="Eliminar" onClick={() => setDeletingHealth(item)}><Trash2 size={15} /></button></nav></article>)}</section>

    <section className="treatment-panel"><div className="treatment-panel__copy"><ShieldAlert /><div><span className="eyebrow">Subsección separada</span><h2>Isotretinoína</h2><p>Este registro es informativo y no sustituye las indicaciones de tu dermatólogo.</p></div></div><Button variant="secondary" icon={<Plus size={14} />} onClick={() => setTreatmentOpen(true)}>Registrar tratamiento</Button>{treatments.length > 0 && <div className="treatment-history">{[...treatments].reverse().slice(0, 5).map((item) => <article key={item.id}><strong>{item.occurredAt.slice(0, 10)}</strong><span>{item.medicationTaken ? 'Medicamento registrado' : 'No tomado'}{item.dosage ? ` · ${item.dosage}` : ''}</span><small>{item.skinCondition || 'Sin nota de piel'}{item.sideEffects ? ` · ${item.sideEffects}` : ''}</small></article>)}</div>}</section>
    {healthOpen && <HealthLogDialog onClose={() => setHealthOpen(false)} onSave={createHealth} />}
    {editingHealth && <HealthLogDialog entry={editingHealth} onClose={() => setEditingHealth(undefined)} onSave={(log) => updateHealth(log.id, log)} />}
    {targetOpen && <WeightTargetDialog value={targetKg} onClose={() => setTargetOpen(false)} onSave={(value) => { localStorage.setItem(targetStorageKey, String(value)); setTargetKg(value); setTargetOpen(false) }} />}
    {treatmentOpen && <TreatmentDialog onClose={() => setTreatmentOpen(false)} onSave={createTreatment} />}
    <ConfirmDialog open={Boolean(deletingHealth)} title="Eliminar registro de salud" description={deletingHealth ? `Se eliminará permanentemente el registro del ${deletingHealth.occurredAt.slice(0, 10)}. La gráfica y la proyección se actualizarán inmediatamente.` : ''} onClose={() => setDeletingHealth(undefined)} onConfirm={() => { if (!deletingHealth) return; deleteHealth(deletingHealth.id); setDeletingHealth(undefined) }} />
  </div>
}

function HealthLogDialog({ entry, onClose, onSave }: { entry?: HealthLog; onClose: () => void; onSave: (log: HealthLog) => void }) {
  const [date, setDate] = useState(entry?.occurredAt.slice(0, 10) ?? format(new Date(), 'yyyy-MM-dd'))
  const [weight, setWeight] = useState(entry?.weightKg ? String(entry.weightKg) : '')
  const [foodQuality, setFoodQuality] = useState<'good' | 'okay' | 'bad'>(entry?.foodQuality ?? 'good')
  const [trained, setTrained] = useState((entry?.trainingMinutes ?? 0) > 0)
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const timestamp = new Date().toISOString()
    onSave({ ...entry, id: entry?.id ?? crypto.randomUUID(), area: 'health', occurredAt: date, energy: entry?.energy ?? 7, foodQuality, weightKg: weight ? Number(weight) : undefined, trainingMinutes: trained ? 1 : 0, movementMinutes: trained ? 1 : 0, notes: notes || undefined, createdAt: entry?.createdAt ?? timestamp, updatedAt: timestamp })
    onClose()
  }
  return <Modal open title="Registro de hoy" onClose={onClose}><form className="tracker-form health-log-form" onSubmit={submit}><label>Fecha<input autoFocus type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Peso (kg)<input type="number" min="20" max="400" step=".1" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="Ej. 72.4" /></label><fieldset><legend>¿Qué tal comí hoy?</legend><div className="health-choice" role="group" aria-label="Calidad de alimentación">{(['good', 'okay', 'bad'] as const).map((value) => <button key={value} type="button" aria-pressed={foodQuality === value} className={foodQuality === value ? 'active' : ''} onClick={() => setFoodQuality(value)}>{foodLabels[value]}</button>)}</div></fieldset><label className="health-trained"><input type="checkbox" checked={trained} onChange={(event) => setTrained(event.target.checked)} /><span>Entrené hoy</span></label><label>Nota <span>opcional</span><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar registro</Button></div></form></Modal>
}

function WeightTargetDialog({ value, onClose, onSave }: { value: number; onClose: () => void; onSave: (value: number) => void }) {
  const [target, setTarget] = useState(String(value))
  return <Modal open title="Meta de peso" onClose={onClose}><form className="tracker-form" onSubmit={(event) => { event.preventDefault(); const parsed = Number(target); if (parsed > 20 && parsed < 400) onSave(parsed) }}><label>Meta para el 31 de diciembre<input autoFocus type="number" min="20" max="400" step=".1" required value={target} onChange={(event) => setTarget(event.target.value)} /></label><p className="medical-notice">Esta meta es personal e informativa. Ajusta cualquier objetivo de salud con un profesional cuando corresponda.</p><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar meta</Button></div></form></Modal>
}

function TreatmentDialog({ onClose, onSave }: { onClose: () => void; onSave: ReturnType<typeof useFaroStore.getState>['createTreatmentLog'] }) {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd')); const [taken, setTaken] = useState(true); const [dosage, setDosage] = useState(''); const [dryness, setDryness] = useState(''); const [skin, setSkin] = useState(''); const [effects, setEffects] = useState(''); const [notes, setNotes] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); const timestamp = new Date().toISOString(); onSave({ id: crypto.randomUUID(), area: 'health', treatment: 'isotretinoin', occurredAt: date, medicationTaken: taken, dosage: dosage || undefined, dryness: dryness ? Number(dryness) : undefined, skinCondition: skin || undefined, sideEffects: effects || undefined, notes: notes || undefined, createdAt: timestamp, updatedAt: timestamp }); onClose() }
  return <Modal open title="Registro de isotretinoína" onClose={onClose}><form className="tracker-form" onSubmit={submit}><div className="medical-notice">Este registro es informativo y no sustituye las indicaciones de tu dermatólogo.</div><label>Fecha<input autoFocus type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="check-label"><input type="checkbox" checked={taken} onChange={(event) => setTaken(event.target.checked)} /> Medicamento tomado</label><label>Dosis escrita por ti <span>opcional</span><input value={dosage} onChange={(event) => setDosage(event.target.value)} placeholder="Sólo registra la indicación recibida" /></label><div className="tracker-form__grid"><label>Resequedad 1–10<input type="number" min="1" max="10" value={dryness} onChange={(event) => setDryness(event.target.value)} /></label><label>Estado de piel<input value={skin} onChange={(event) => setSkin(event.target.value)} /></label></div><label>Efectos secundarios <span>opcional</span><input value={effects} onChange={(event) => setEffects(event.target.value)} /></label><label>Notas <span>opcional</span><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar registro</Button></div></form></Modal>
}
