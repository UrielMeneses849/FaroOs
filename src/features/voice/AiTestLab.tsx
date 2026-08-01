import { CheckCircle2, FlaskConical, KeyRound, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/common'
import { useAuth } from '../../hooks/auth/useAuth'
import { aiTestLabService, type AiTestBaseline } from '../../services/aiTestLabService'
import { voiceService } from '../../services/voiceService'

const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })

export function AiTestLab({ onPrepared }: { onPrepared?: () => void }) {
  const { user } = useAuth()
  const [nuBalance, setNuBalance] = useState(10000)
  const [bbvaBalance, setBbvaBalance] = useState(15000)
  const [budget, setBudget] = useState(3000)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState<'connection' | 'prepare' | 'baseline' | null>(null)
  const [connection, setConnection] = useState<{ ok: boolean; message: string } | null>(null)
  const [baseline, setBaseline] = useState<AiTestBaseline | null>(null)
  const [error, setError] = useState('')

  const run = async (kind: NonNullable<typeof busy>, action: () => Promise<void>) => {
    setBusy(kind); setError('')
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : 'No pudimos completar la operación.') }
    finally { setBusy(null) }
  }

  return <section className="settings-group ai-test-lab">
    <div className="settings-group__head"><FlaskConical /><div><h2>Laboratorio de FARO + OpenAI</h2><p>Comprueba la conexión y prepara datos aislados antes de permitir acciones conversacionales.</p></div></div>
    <div className="ai-test-lab__warning"><ShieldAlert size={18} /><div><strong>Identidad de laboratorio confirmada.</strong><span>Sesión: {user?.email ?? `anónima ${user?.id.slice(0, 8)}`}. RLS aísla sus cuentas, movimientos y métricas.</span></div></div>
    <div className="ai-test-lab__connection">
      <div><KeyRound size={17} /><div><strong>Conexión del servidor</strong><span>La clave se lee dentro de la Edge Function; nunca se descarga al navegador.</span></div></div>
      <Button variant="secondary" disabled={busy !== null} onClick={() => void run('connection', async () => { const response = await voiceService.health(); setConnection({ ok: response.status === 'completed', message: response.message }) })}>{busy === 'connection' ? 'Verificando…' : 'Verificar OpenAI'}</Button>
    </div>
    {connection && <div className={`ai-test-lab__status ${connection.ok ? 'is-ok' : 'is-error'}`} role="status">{connection.ok ? <CheckCircle2 size={15} /> : <ShieldAlert size={15} />}{connection.message}</div>}
    <div className="ai-test-lab__form">
      <label>Saldo NU Pruebas<input type="number" min="0" step="100" value={nuBalance} onChange={(event) => setNuBalance(Number(event.target.value))} /></label>
      <label>Saldo BBVA Pruebas<input type="number" min="0" step="100" value={bbvaBalance} onChange={(event) => setBbvaBalance(Number(event.target.value))} /></label>
      <label>Presupuesto Personal<input type="number" min="0" step="100" value={budget} onChange={(event) => setBudget(Number(event.target.value))} /></label>
    </div>
    <label className="ai-test-lab__confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>Confirmo que esta sesión pertenece a un usuario exclusivo de pruebas y no contiene cuentas financieras reales.</span></label>
    <div className="ai-test-lab__actions">
      <Button disabled={!confirmed || busy !== null} onClick={() => void run('prepare', async () => {
        setBaseline(await aiTestLabService.prepare(nuBalance, bbvaBalance, budget))
        onPrepared?.()
      })}>{busy === 'prepare' ? 'Preparando…' : 'Preparar laboratorio'}</Button>
      <Button variant="secondary" disabled={!confirmed || busy !== null} onClick={() => void run('baseline', async () => setBaseline(await aiTestLabService.captureBaseline()))}>Capturar línea base</Button>
    </div>
    <p className="ai-test-lab__seed">Se crean o reactivan: NU Pruebas, BBVA Pruebas; Comida, Personal, Transporte, Servicios y Sin categoría. La operación es repetible y no duplica nombres.</p>
    {error && <div className="ai-test-lab__status is-error" role="alert">{error}</div>}
    {baseline && <div className="ai-test-baseline"><header><div><span>Línea base</span><strong>{new Date(baseline.captured_at).toLocaleString('es-MX')}</strong></div><small>{baseline.period_start} — {baseline.period_end}</small></header><div>
      <Metric label="Disponible operativo" value={baseline.available_operating} />
      <Metric label="Balance real" value={baseline.real_balance} />
      <Metric label="Balance proyectado" value={baseline.projected_balance} />
      <Metric label="Gastos del periodo" value={baseline.period_expenses} />
      <Metric label="Presupuesto Personal consumido" value={baseline.personal_budget_consumed} />
    </div></div>}
  </section>
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article><span>{label}</span><strong>{money.format(Number(value))}</strong></article>
}
