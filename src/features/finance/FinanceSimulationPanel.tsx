import { useRef, useState, type FormEvent } from 'react'
import { format } from 'date-fns'
import { FlaskConical, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Button, ConfirmDialog } from '../../components/common'
import type { FinanceData } from './financeTypes'
import type { FinanceSimulationItem, FinanceSimulationState } from '../../services/financeSimulation'
import { debtRemainingCents } from '../../services/debtSchedule'
import { formatFinanceDate, formatMxn } from '../../services/financeService'
import './finance-simulation.css'

interface Props {
  data: FinanceData
  state: FinanceSimulationState
  onSave: (item: FinanceSimulationItem) => void
  onRemove: (id: string) => void
  onClear: () => void
  onOpenProjection: () => void
}

export function FinanceSimulationPanel({ data, state, onSave, onRemove, onClear, onOpenProjection }: Props) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const accounts = data.accounts.filter(account => account.isActive && account.currency === 'MXN')
  const debts = (data.debtPlan?.debts ?? []).filter(debt => debt.status === 'active' && debtRemainingCents(debt, data) > 0)
  const [editingId, setEditingId] = useState<string>()
  const [kind, setKind] = useState<FinanceSimulationItem['kind']>('expense')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(today)
  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [categoryId, setCategoryId] = useState('')
  const [debtId, setDebtId] = useState(debts[0]?.id ?? '')
  const [settles, setSettles] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const selectedDebt = debts.find(debt => debt.id === debtId)
  const categories = data.categories.filter(category => category.isActive && (kind === 'income'
    ? category.type === 'income' : category.type === 'expense' || category.type === 'debt'))
  const resetForm = () => { setEditingId(undefined); setDescription(''); setAmount(''); setDate(today); setCategoryId(''); setSettles(false); setError('') }
  const edit = (item: FinanceSimulationItem) => {
    setEditingId(item.id); setKind(item.kind); setDescription(item.description); setDate(item.date)
    setAmount(String(item.amountCents / 100)); setAccountId(item.accountId); setCategoryId(item.categoryId ?? '')
    setDebtId(item.debtId ?? debts[0]?.id ?? ''); setSettles(Boolean(item.settles)); setError(''); setNotice('')
    nameInputRef.current?.focus({ preventScroll: true })
    if (window.matchMedia?.('(max-width: 760px)').matches) formRef.current?.scrollIntoView?.({
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start',
    })
  }
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError(''); setNotice('')
    const amountCents = Math.round(Number(amount) * 100)
    if (!description.trim() || !Number.isSafeInteger(amountCents) || amountCents <= 0 || !accounts.some(account => account.id === accountId)
      || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) return setError('Revisa el nombre, la fecha y el monto. La simulación empieza hoy o en una fecha futura.')
    if (kind === 'debt_payment' && !selectedDebt) return setError('Selecciona una deuda activa.')
    try {
      onSave({ id: editingId ?? crypto.randomUUID(), kind, description: description.trim(), date, amountCents, accountId,
        categoryId: categoryId || undefined, debtId: kind === 'debt_payment' ? debtId : undefined,
        settles: kind === 'debt_payment' ? settles : undefined })
      resetForm(); setNotice(state.enabled ? 'Movimiento agregado al escenario. Ya puedes revisar su impacto.' : 'Movimiento guardado. Activa el modo simulación para ver su impacto.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar el movimiento simulado.') }
  }
  const pendingTotal = state.items.filter(item => item.date >= today && item.kind !== 'income').reduce((sum, item) => sum + item.amountCents, 0)
  return <section className="finance-simulation" aria-label="Simulaciones guardadas">
    <header className="fsim-head"><div><span className="fsim-eyebrow">TU ESPACIO PARA PROBAR</span><h2>Planea antes de mover tu dinero</h2><p>Agrega compras, ingresos o pagos anticipados. El interruptor de arriba aplica o retira todo el escenario.</p></div><FlaskConical size={28} aria-hidden="true" /></header>
    <div className="fsim-summary"><div><span>Movimientos guardados</span><strong>{state.items.length}</strong></div><div><span>Salidas futuras del escenario</span><strong>{formatMxn(pendingTotal)}</strong></div><div><span>Estado</span><strong>{state.enabled ? 'Simulación activa' : 'Escenario en pausa'}</strong></div></div>
    <div className="fsim-columns">
      <form ref={formRef} className="fsim-card fsim-form" onSubmit={submit} aria-label="Movimiento simulado">
        <h3>{editingId ? 'Editar movimiento simulado' : 'Agregar al escenario'}</h3>
        <label>Qué quieres probar<select value={kind} onChange={event => { setKind(event.target.value as FinanceSimulationItem['kind']); setCategoryId(''); setSettles(false) }}><option value="expense">Un gasto o compra</option><option value="income">Un ingreso</option><option value="debt_payment">Un abono o liquidación de deuda</option></select></label>
        <label>Nombre del movimiento<input ref={nameInputRef} required maxLength={160} value={description} onChange={event => setDescription(event.target.value)} placeholder="Ej. Liquidar la moto en diciembre" /></label>
        <div className="fsim-fields"><label>Monto simulado MXN<input required type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label><label>Fecha simulada<input required type="date" min={today} value={date} onChange={event => setDate(event.target.value)} /></label></div>
        <label>Cuenta del escenario<select required value={accountId} onChange={event => setAccountId(event.target.value)}><option value="">Selecciona una cuenta</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label>Categoría<select value={categoryId} onChange={event => setCategoryId(event.target.value)}><option value="">Sin categoría</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        {kind === 'debt_payment' && <><label>Deuda que quieres pagar<select required value={debtId} onChange={event => setDebtId(event.target.value)}><option value="">Selecciona una deuda</option>{debts.map(debt => <option key={debt.id} value={debt.id}>{debt.name}</option>)}</select></label>{selectedDebt && <p className="fsim-note">Saldo actual: {formatMxn(debtRemainingCents(selectedDebt, data))}. El monto de liquidación debe corresponder a una cotización que tú verifiques.</p>}<label className="fsim-checkbox"><input type="checkbox" checked={settles} onChange={event => setSettles(event.target.checked)} />Este pago liquidaría la deuda</label><p className="fsim-note">La proyección retira los pagos posteriores a la liquidación. Un abono parcial conserva los pagos hasta cubrir el saldo restante.</p></>}
        {error && <p role="alert" className="fsim-error">{error}</p>}{notice && <p role="status" className="fsim-note">{notice}</p>}
        <div className="fsim-actions"><Button type="submit" icon={<Plus size={15} />} disabled={!accounts.length}>{editingId ? 'Guardar cambios del escenario' : 'Agregar movimiento simulado'}</Button>{editingId && <Button type="button" variant="ghost" onClick={resetForm}>Cancelar edición</Button>}</div>
        {!accounts.length && <p className="fsim-note">Crea una cuenta activa en MXN desde Finanzas para comenzar.</p>}
      </form>
      <section className="fsim-card"><div className="fsim-section-head"><h3>Tu escenario guardado</h3><Button variant="ghost" icon={<RotateCcw size={14} />} disabled={!state.items.length} onClick={() => setConfirmClear(true)}>Reiniciar y limpiar</Button></div>
        <p className="fsim-note">Guardado en este dispositivo y separado por usuario. Apagar el modo conserva esta lista. Los movimientos con fecha pasada permanecen guardados y dejan de aplicarse.</p>
        <div className="fsim-list">{state.items.slice().sort((a, b) => a.date.localeCompare(b.date)).map(item => <article key={item.id} className={item.date < today ? 'fsim-item is-expired' : 'fsim-item'}><header><div><strong>{item.description}</strong><small>{formatFinanceDate(item.date)} · {item.kind === 'income' ? 'Ingreso' : item.kind === 'debt_payment' ? item.settles ? 'Liquidación' : 'Abono de deuda' : 'Gasto'}</small></div><b>{item.kind === 'income' ? '+' : '−'}{formatMxn(item.amountCents)}</b></header>{item.date < today && <small>Fecha pasada · no se aplica a la proyección</small>}<footer><Button size="sm" variant="ghost" icon={<Pencil size={13} />} aria-label={`Editar simulación ${item.description}`} onClick={() => edit(item)}>Editar</Button><Button size="sm" variant="ghost" icon={<Trash2 size={13} />} aria-label={`Eliminar simulación ${item.description}`} onClick={() => { onRemove(item.id); if (editingId === item.id) resetForm() }}>Eliminar</Button></footer></article>)}{!state.items.length && <p className="fsim-empty">Tu escenario está vacío. Empieza con una compra o un pago que quieras adelantar.</p>}</div>
        <Button variant="secondary" disabled={!state.items.some(item => item.date >= today)} onClick={onOpenProjection}>{state.enabled ? 'Ver impacto en Proyecciones' : 'Activar y ver impacto'}</Button>
      </section>
    </div>
    <ConfirmDialog open={confirmClear} title="Reiniciar y limpiar simulaciones" description="Se eliminarán los movimientos de este escenario guardados en este dispositivo y se apagará la simulación. Tus registros financieros reales se conservan." confirmLabel="Limpiar escenario" onClose={() => setConfirmClear(false)} onConfirm={() => { onClear(); resetForm(); setConfirmClear(false) }} />
  </section>
}
