import { useRef, useState, type FormEvent } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, ConfirmDialog, Modal } from '../../components/common'
import type { FinanceCategory, FinanceCategoryType, FinanceGoalContribution, FinanceSavingsFundEntry } from './financeTypes'

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'No se pudo guardar el cambio. Intenta de nuevo.'
const categoryTypes: Record<FinanceCategoryType, string> = { income: 'Ingreso', expense: 'Gasto', saving: 'Ahorro', debt: 'Pago de deuda', transfer: 'Transferencia' }

export function FinanceCategoryManager({ categories, onClose, onSave, onDelete }: { categories: FinanceCategory[]; onClose: () => void; onSave: (category: FinanceCategory) => Promise<void>; onDelete: (category: FinanceCategory) => Promise<void> }) {
  const [editing, setEditing] = useState<FinanceCategory | null>()
  const [name, setName] = useState('')
  const [type, setType] = useState<FinanceCategoryType>('expense')
  const [deleting, setDeleting] = useState<FinanceCategory>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const edit = (category: FinanceCategory | null) => { setEditing(category); setName(category?.name ?? ''); setType(category?.type ?? 'expense'); setError('') }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (lock.current) return
    const cleaned = name.trim()
    if (!cleaned || cleaned.length > 60) { setError('Escribe un nombre de hasta 60 caracteres.'); return }
    lock.current = true; setBusy(true); setError('')
    try { await onSave({ ...editing, id: editing?.id ?? crypto.randomUUID(), name: cleaned, type, isDefault: false, isActive: editing?.isActive ?? true }); setEditing(undefined) }
    catch (reason) { setError(errorMessage(reason)) }
    finally { lock.current = false; setBusy(false) }
  }
  return <>
    <Modal open title="Categorías de Finanzas" panelClassName="finance-dialog" onClose={onClose}>
      <p className="finance-form-hint">Administra las categorías que creaste. Las categorías del sistema se conservan para los cálculos de FARO.</p>
      {editing === undefined ? <Button size="sm" icon={<Plus size={14} />} onClick={() => edit(null)}>Nueva categoría</Button> : <form className="finance-form" onSubmit={submit}>
        <label>Nombre de categoría<input autoFocus required maxLength={60} value={name} onChange={event => setName(event.target.value)} /></label>
        <label>Tipo de categoría<select value={type} disabled={Boolean(editing)} onChange={event => setType(event.target.value as FinanceCategoryType)}>{Object.entries(categoryTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <div className="modal-actions"><Button type="button" variant="ghost" disabled={busy} onClick={() => setEditing(undefined)}>Cancelar edición</Button><Button type="submit" loading={busy}>{editing ? 'Actualizar categoría' : 'Crear categoría'}</Button></div>
      </form>}
      {error && <p className="finance-form-error" role="alert">{error}</p>}
      <div className="finance-record-list">{categories.map(category => <article key={category.id}>
        <div><strong>{category.name}</strong><small>{categoryTypes[category.type]}{category.isDefault ? ' · Sistema' : ''}</small></div>
        {!category.isDefault && <nav aria-label={`Acciones de ${category.name}`}><Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => edit(category)}>Editar</Button><Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => { setDeleting(category); setError('') }}>Eliminar</Button></nav>}
      </article>)}</div>
    </Modal>
    <ConfirmDialog open={Boolean(deleting)} title="Eliminar categoría" description={`Eliminarás “${deleting?.name ?? ''}”. Si está vinculada a movimientos o presupuestos, FARO conservará su historial y bloqueará la eliminación.`} confirmLabel="Eliminar categoría" onClose={() => setDeleting(undefined)} onConfirm={() => {
      if (!deleting || lock.current) return
      lock.current = true; setBusy(true)
      void onDelete(deleting).then(() => { setDeleting(undefined); setError('') }).catch(reason => { setDeleting(undefined); setError(errorMessage(reason)) }).finally(() => { lock.current = false; setBusy(false) })
    }} />
  </>
}

export function FundEntryEditor({ fundId, initial, balanceCents, onClose, onSave }: { fundId: string; initial?: FinanceSavingsFundEntry; balanceCents: number; onClose: () => void; onSave: (entry: Omit<FinanceSavingsFundEntry, 'createdAt'>) => Promise<void> }) {
  const [kind, setKind] = useState(initial && initial.amountCents < 0 ? 'withdraw' : 'deposit')
  const [amount, setAmount] = useState(initial ? String(Math.abs(initial.amountCents) / 100) : '')
  const [date, setDate] = useState(initial?.entryDate ?? new Date().toLocaleDateString('en-CA'))
  const [description, setDescription] = useState(initial?.description ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false), id = useRef(initial?.id ?? crypto.randomUUID())
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (lock.current) return
    const value = Math.round(Number(amount) * 100) * (kind === 'withdraw' ? -1 : 1)
    if (!Number.isSafeInteger(value) || !value || Number(amount) <= 0 || !date) { setError('Revisa el importe y la fecha.'); return }
    if (balanceCents - (initial?.amountCents ?? 0) + value < 0) { setError('Este cambio dejaría el fondo sin saldo suficiente.'); return }
    lock.current = true; setBusy(true); setError('')
    try { await onSave({ id: id.current, fundId, amountCents: value, entryDate: date, description: description.trim() || undefined }) }
    catch (reason) { setError(errorMessage(reason)) }
    finally { lock.current = false; setBusy(false) }
  }
  return <Modal open title={initial ? 'Editar movimiento del fondo' : 'Movimiento del fondo'} panelClassName="finance-dialog" onClose={onClose}><form className="finance-form" onSubmit={submit}>
    <label>Tipo<select value={kind} onChange={event => setKind(event.target.value)}><option value="deposit">Aportación</option><option value="withdraw">Retiro</option></select></label>
    <label>Importe MXN<input autoFocus required type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label>
    <label>Fecha<input required type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
    <label>Descripción<input maxLength={160} value={description} onChange={event => setDescription(event.target.value)} /></label>
    {error && <p role="alert" className="finance-form-error">{error}</p>}
    <div className="modal-actions"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy}>{initial ? 'Actualizar movimiento' : 'Registrar movimiento'}</Button></div>
  </form></Modal>
}

export function ReservedContributionEditor({ initial, goalName, onClose, onSave }: { initial: FinanceGoalContribution; goalName: string; onClose: () => void; onSave: (contribution: FinanceGoalContribution) => Promise<void> }) {
  const [amount, setAmount] = useState(String(initial.amountCents / 100)), [date, setDate] = useState(initial.contributionDate)
  const [description, setDescription] = useState(initial.description ?? ''), [notes, setNotes] = useState(initial.notes ?? '')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const lock = useRef(false)
  return <Modal open title={`Editar aportación · ${goalName}`} panelClassName="finance-dialog" onClose={onClose}><form className="finance-form" onSubmit={async event => {
    event.preventDefault()
    if (lock.current) return
    const value = Math.round(Number(amount) * 100)
    if (!Number.isSafeInteger(value) || value <= 0 || !date) { setError('Revisa el importe y la fecha.'); return }
    lock.current = true; setBusy(true); setError('')
    try { await onSave({ ...initial, amountCents: value, contributionDate: date, description: description.trim() || undefined, notes: notes.trim() || undefined }) }
    catch (reason) { setError(errorMessage(reason)) }
    finally { lock.current = false; setBusy(false) }
  }}><p className="finance-form-hint">Esta aportación ya estaba apartada; editarla no crea un movimiento en tus cuentas.</p>
    <label>Importe MXN<input autoFocus required type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label>
    <label>Fecha<input required type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
    <label>Descripción<input maxLength={160} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <label>Notas<textarea value={notes} onChange={event => setNotes(event.target.value)} /></label>
    {error && <p className="finance-form-error" role="alert">{error}</p>}
    <div className="modal-actions"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy}>Actualizar aportación</Button></div>
  </form></Modal>
}
