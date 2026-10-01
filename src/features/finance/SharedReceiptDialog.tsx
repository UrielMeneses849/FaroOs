import { format } from 'date-fns'
import { FileImage, ScanLine } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button, Modal } from '../../components/common'
import { personalBudgetForDate } from '../../services/financeService'
import { financeTransactionSchema } from './financeSchemas'
import type { FinanceAccount, FinanceBudget, FinanceCategory, FinanceTransaction } from './financeTypes'
import { parseNuReceipt } from './nuReceiptParser'

interface Props {
  file: File
  accounts: FinanceAccount[]
  categories: FinanceCategory[]
  budgets: FinanceBudget[]
  onClose: () => void
  onSave: (item: Omit<FinanceTransaction, 'createdAt' | 'updatedAt'>) => Promise<void>
}

export function SharedReceiptDialog({ file, accounts, categories, budgets, onClose, onSave }: Props) {
  const [scanning, setScanning] = useState(true)
  const [scanError, setScanError] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState(accounts.find((account) => /\bnu\b/i.test(account.name))?.id ?? accounts[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const previewUrl = useMemo(() => URL.createObjectURL(file), [file])

  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl])
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const { recognize } = await import('tesseract.js')
        const result = await recognize(file, 'spa')
        if (!active) return
        const parsed = parseNuReceipt(result.data.text)
        if (parsed.amountCents) setAmount((parsed.amountCents / 100).toFixed(2))
        if (parsed.date) setDate(parsed.date)
        setDescription(parsed.suggestedName)
        if (!parsed.amountCents) setScanError('No pude leer el monto con seguridad. Confírmalo antes de guardar.')
      } catch {
        if (active) setScanError('No pude leer la imagen automáticamente. Completa el monto para continuar.')
      } finally {
        if (active) setScanning(false)
      }
    })()
    return () => { active = false }
  }, [file])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const category = categories.find((item) => item.id === categoryId)
    const personalExpense = ['personal', 'gastos personales'].includes(category?.name.trim().toLocaleLowerCase('es-MX') ?? '')
    const result = financeTransactionSchema.safeParse({
      type: 'expense',
      amountCents: Math.round(Number(amount) * 100),
      transactionDate: date,
      description: description.trim(),
      accountId,
      categoryId,
      status: 'completed',
      budgetId: personalExpense ? personalBudgetForDate(budgets, date)?.id : undefined,
    })
    if (!result.success) return setError(result.error.issues[0]?.message ?? 'Revisa los datos del comprobante.')
    setSaving(true); setError('')
    try { await onSave({ id: crypto.randomUUID(), ...result.data }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar el gasto.'); setSaving(false) }
  }

  return <Modal open title="Capturar comprobante" panelClassName="shared-receipt-modal" onClose={onClose}>
    <form className="shared-receipt" onSubmit={(event) => void submit(event)}>
      <div className="shared-receipt__intro"><span><FileImage size={17} /> Imagen compartida</span><p>FARO lee el comprobante en este dispositivo. Revisa el importe antes de confirmar; la imagen no se sube a un servidor.</p></div>
      <div className="shared-receipt__preview"><img src={previewUrl} alt="Comprobante compartido para revisión" /></div>
      {scanning && <p className="shared-receipt__scanning" role="status"><ScanLine size={17} /> Leyendo comprobante…</p>}
      {scanError && !scanning && <p className="shared-receipt__notice" role="status">{scanError}</p>}
      <div className="shared-receipt__amount"><label htmlFor="shared-receipt-amount">Importe detectado · MXN</label><input id="shared-receipt-amount" type="number" inputMode="decimal" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></div>
      <div className="shared-receipt__fields"><label>Nombre del gasto<input required maxLength={160} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="¿En qué gastaste?" /></label><label>Categoría<select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Elige una categoría</option>{categories.filter((category) => category.type === 'expense' && category.isActive).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></div>
      <details className="shared-receipt__details"><summary>Cuenta y fecha detectada</summary><div className="shared-receipt__fields"><label>Cuenta de origen<select required value={accountId} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Fecha<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label></div></details>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving || scanning || !accounts.length}>{saving ? 'Guardando…' : 'Guardar gasto'}</Button></div>
    </form>
  </Modal>
}
