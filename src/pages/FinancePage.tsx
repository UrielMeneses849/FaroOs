import { addDays, addMonths, endOfMonth, format, isSameDay, parseISO, subMonths } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight,
  Ban, Check, Copy, Landmark, MoreHorizontal, Pencil, PiggyBank, Plus, RefreshCw, Repeat2,
  RotateCcw, Target, Trash2, WalletCards,
} from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Button, ConfirmDialog, EmptyState, Modal, ProgressBar } from '../components/common'
import {
  financeAccountSchema, financeBudgetSchema, financeGoalSchema, financeTransactionSchema,
} from '../features/finance/financeSchemas'
import type {
  FinanceAccount, FinanceGoal, FinanceRecurringOccurrence, FinanceRecurringTransaction, FinanceTransaction,
  FinanceTransactionStatus, FinanceTransactionType,
} from '../features/finance/financeTypes'
import { useFinance } from '../hooks/useFinance'
import {
  financeAccountRepository, financeBudgetRepository, financeGoalRepository,
  financeRecurringOccurrenceRepository, financeRecurringRepository, financeTransactionRepository,
} from '../repositories/financeRepositories'
import {
  accountBalance, annualFinanceTotals, budgetPerformance, calculateFinanceMetrics, financeFrequencyLabel, financeSummary,
  formatFinanceDate, formatMxn, goalProgress, monthKey, recurringAppliesToMonth, recurringExpectedDate,
} from '../services/financeService'

type Panel = 'overview' | 'transactions' | 'income' | 'accounts' | 'budgets' | 'recurring' | 'savings' | 'goals'
type Dialog = 'movementMenu' | 'transaction' | 'account' | 'budget' | 'recurring' | 'goal' | 'contribution' | null
interface MovementPreset { type: FinanceTransactionType; categoryName?: string; status?: FinanceTransactionStatus }
const typeLabel: Record<FinanceTransactionType, string> = {
  income: 'Ingreso', expense: 'Gasto', transfer: 'Transferencia', saving: 'Ahorro',
  debt_payment: 'Pago de deuda', refund: 'Reembolso',
}
const statusLabel: Record<FinanceTransactionStatus, string> = {
  planned: 'Planeado', pending: 'Pendiente', completed: 'Completado', cancelled: 'Cancelado',
}

export function FinancePage() {
  const { data, loading, error, refresh, user } = useFinance()
  const [month, setMonth] = useState(() => new Date())
  const [panel, setPanel] = useState<Panel>(() => {
    const stored = sessionStorage.getItem('faro-finance-panel')
    return ['overview', 'transactions', 'income', 'budgets', 'recurring', 'savings', 'goals', 'accounts'].includes(stored ?? '')
      ? stored as Panel : 'overview'
  })
  const [dialog, setDialog] = useState<Dialog>(null)
  const [movementPreset, setMovementPreset] = useState<MovementPreset>()
  const [editingTransaction, setEditingTransaction] = useState<FinanceTransaction>()
  const [editingAccount, setEditingAccount] = useState<FinanceAccount>()
  const [editingRecurring, setEditingRecurring] = useState<FinanceRecurringTransaction>()
  const [editingGoal, setEditingGoal] = useState<FinanceGoal>()
  const [selectedGoal, setSelectedGoal] = useState<FinanceGoal>()
  const [deleting, setDeleting] = useState<FinanceTransaction>()
  const [deletingAccount, setDeletingAccount] = useState<FinanceAccount>()
  const [deletingRecurring, setDeletingRecurring] = useState<FinanceRecurringTransaction>()
  const [revertingOccurrence, setRevertingOccurrence] = useState<FinanceRecurringOccurrence>()
  const [actionsFor, setActionsFor] = useState<string>()
  const paymentLocks = useRef(new Set<string>())
  const [savingPaymentId, setSavingPaymentId] = useState<string>()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [accountFilter, setAccountFilter] = useState('all')
  const [feedback, setFeedback] = useState('')
  const activeAccounts = data.accounts.filter((item) => item.isActive)

  useEffect(() => {
    if (!feedback) return
    const timeout = window.setTimeout(() => setFeedback(''), 3000)
    return () => window.clearTimeout(timeout)
  }, [feedback])

  const metrics = useMemo(() => calculateFinanceMetrics(data, month), [data, month])
  const annualTotals = useMemo(() => annualFinanceTotals(data, month.getFullYear()), [data, month])
  const previous = useMemo(() => calculateFinanceMetrics(data, subMonths(month, 1)), [data, month])
  const summary = useMemo(() => financeSummary(data, month), [data, month])
  const budgets = useMemo(() => budgetPerformance(data, month), [data, month])
  const previousMonthKey = format(subMonths(month, 1), 'yyyy-MM')
  const hasPreviousData = data.transactions.some((item) => item.transactionDate.startsWith(previousMonthKey))
  const monthlyTransactions = data.transactions.filter((item) => item.transactionDate.startsWith(format(month, 'yyyy-MM')))
  const selectedPeriod = monthKey(month)
  const recurringForMonth = data.recurring
    .filter((item) => recurringAppliesToMonth(item, month))
    .map((item) => {
      const occurrence = data.recurringOccurrences.find((candidate) =>
        candidate.recurringTransactionId === item.id && candidate.period === selectedPeriod)
      return { item, occurrence, expectedDate: occurrence?.expectedDate }
    })
    .sort((left, right) => {
      const rank = (status?: string) => status === 'paid' || status === 'skipped' ? 1 : 0
      return rank(left.occurrence?.status) - rank(right.occurrence?.status)
        || (left.expectedDate ?? '9999-12-31').localeCompare(right.expectedDate ?? '9999-12-31')
    })
  const filteredTransactions = monthlyTransactions.filter((item) =>
    (!search || `${item.description} ${item.notes ?? ''}`.toLowerCase().includes(search.toLowerCase()))
    && (typeFilter === 'all' || item.type === typeFilter)
    && (statusFilter === 'all' || item.status === statusFilter)
    && (accountFilter === 'all' || item.accountId === accountFilter),
  )
  const categoryExpenses = data.categories.map((category) => ({
    name: category.name,
    value: monthlyTransactions.filter((item) =>
      item.categoryId === category.id && item.status === 'completed'
      && (item.type === 'expense' || item.type === 'debt_payment'))
      .reduce((sum, item) => sum + item.amountCents, 0),
  })).filter((item) => item.value > 0)
  const trend = Array.from({ length: 6 }, (_, index) => {
    const current = subMonths(month, 5 - index)
    const item = calculateFinanceMetrics(data, current)
    return { month: format(current, 'MMM', { locale: es }), ingresos: item.monthlyIncomeCents / 100, gastos: item.monthlyExpensesCents / 100 }
  })
  const finish = async (message: string) => {
    setDialog(null); setEditingTransaction(undefined); setEditingAccount(undefined)
    setEditingRecurring(undefined); setEditingGoal(undefined); setSelectedGoal(undefined)
    await refresh(); setFeedback(message)
  }
  const status = async (transaction: FinanceTransaction, next: FinanceTransactionStatus) => {
    if (!user) return
    await financeTransactionRepository.setStatus(transaction.id, next, user.id)
    await finish('Movimiento actualizado.')
  }
  const changePanel = (next: Panel) => {
    setPanel(next)
    sessionStorage.setItem('faro-finance-panel', next)
  }
  const startMovement = (preset: MovementPreset) => {
    setMovementPreset(preset)
    setDialog('transaction')
  }
  const registerRecurringPayment = async (item: FinanceRecurringTransaction) => {
    if (!user || paymentLocks.current.has(item.id)) return
    const currentOccurrence = data.recurringOccurrences.find((occurrence) =>
      occurrence.recurringTransactionId === item.id && occurrence.period === selectedPeriod)
    if (!currentOccurrence?.amountCents) {
      setFeedback('Define el monto y la fecha de este periodo antes de registrarlo.')
      return
    }
    const expectedDate = currentOccurrence.expectedDate
    if (currentOccurrence?.status === 'paid' || data.transactions.some((transaction) =>
      transaction.recurringTransactionId === item.id
      && transaction.transactionDate === expectedDate && transaction.status !== 'cancelled')) {
      setFeedback('Este periodo ya tiene un pago registrado.')
      return
    }
    paymentLocks.current.add(item.id); setSavingPaymentId(item.id)
    try {
      await financeRecurringOccurrenceRepository.register(item.id, selectedPeriod, expectedDate, user.id)
      await finish(item.type === 'income' ? 'Cobro registrado.' : 'Pago registrado.')
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'No se pudo registrar la ocurrencia.')
    } finally {
      paymentLocks.current.delete(item.id); setSavingPaymentId(undefined)
    }
  }
  const revertRecurringPayment = async () => {
    if (!user || !revertingOccurrence || paymentLocks.current.has(revertingOccurrence.recurringTransactionId)) return
    const recurringId = revertingOccurrence.recurringTransactionId
    paymentLocks.current.add(recurringId); setSavingPaymentId(recurringId)
    try {
      await financeRecurringOccurrenceRepository.revert(revertingOccurrence.id, user.id)
      setRevertingOccurrence(undefined)
      await finish('Registro recurrente deshecho.')
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'No se pudo deshacer el registro.')
    } finally {
      paymentLocks.current.delete(recurringId); setSavingPaymentId(undefined)
    }
  }
  const setRecurringMonthStatus = async (item: FinanceRecurringTransaction, next: 'skipped' | 'postponed') => {
    if (!user || paymentLocks.current.has(item.id)) return
    paymentLocks.current.add(item.id); setSavingPaymentId(item.id)
    try {
      const expectedDate = recurringExpectedDate(item, month)
      const occurrence = data.recurringOccurrences.find((candidate) =>
        candidate.recurringTransactionId === item.id && candidate.period === selectedPeriod)
        ?? await financeRecurringOccurrenceRepository.ensure(item.id, selectedPeriod, expectedDate, user.id)
      await financeRecurringOccurrenceRepository.setStatus(occurrence.id, next, user.id)
      await finish(next === 'skipped' ? 'Periodo saltado.' : 'Pago pospuesto.')
    } finally {
      paymentLocks.current.delete(item.id); setSavingPaymentId(undefined)
    }
  }
  const registerEventualPayment = async (item: FinanceTransaction) => {
    if (item.status !== 'planned' || paymentLocks.current.has(item.id)) return
    paymentLocks.current.add(item.id); setSavingPaymentId(item.id)
    try { await status(item, 'completed') }
    finally { paymentLocks.current.delete(item.id); setSavingPaymentId(undefined) }
  }

  if (loading && !data.categories.length) return <div className="page"><div className="planning-skeleton">Sincronizando finanzas…</div></div>
  if (error && !data.categories.length) return <div className="page"><EmptyState title="No pudimos cargar Finanzas" description={error} action={<Button onClick={refresh}>Reintentar</Button>} /></div>

  return <div className="page finance-os">
    <header className="finance-header">
      <div><span className="eyebrow">Sistema financiero personal</span><h1>Finanzas</h1><p>Control real, proyección y dirección financiera.</p>
        <div className="finance-period"><button aria-label="Mes anterior" onClick={() => setMonth((value) => subMonths(value, 1))}><ArrowLeft size={15} /></button><label>Periodo<input type="month" value={format(month, 'yyyy-MM')} onChange={(event) => event.target.value && setMonth(parseISO(`${event.target.value}-01`))} /></label><button aria-label="Mes siguiente" onClick={() => setMonth((value) => addMonths(value, 1))}><ArrowRight size={15} /></button><button aria-label="Actualizar datos financieros" title="Actualizar" onClick={() => void refresh()}><RefreshCw size={14} /></button></div>
      </div>
      <Button icon={<Plus size={17} />} disabled={!activeAccounts.length} onClick={() => setDialog('movementMenu')}>Nuevo movimiento</Button>
    </header>
    {feedback && <div className="finance-feedback" role="status">{feedback}<button onClick={() => setFeedback('')}>×</button></div>}
    {!data.accounts.length && <section className="finance-onboarding"><WalletCards /><div><strong>Crea tu primera cuenta</strong><p>El saldo inicial será la base de tus cálculos. Después podrás registrar tu primer ingreso sin ingresar datos bancarios sensibles.</p></div><Button onClick={() => setDialog('account')}>Crear cuenta</Button><Button variant="ghost" disabled title="Crea una cuenta antes de registrar el ingreso">Registrar ingreso</Button></section>}
    <FinanceMetrics metrics={metrics} previous={previous} hasPreviousData={hasPreviousData} />
    <nav className="finance-tabs" aria-label="Secciones financieras">
      {([['overview', 'Resumen'], ['transactions', 'Movimientos'], ['income', 'Ingresos'], ['recurring', 'Gastos'], ['savings', 'Ahorro'], ['budgets', 'Presupuesto'], ['goals', 'Metas'], ['accounts', 'Cuentas']] as const).map(([id, label]) =>
        <button key={id} className={panel === id ? 'active' : ''} onClick={() => changePanel(id)}>{label}</button>)}
    </nav>
    <div className="finance-content">

    {panel === 'overview' && <>
      <section className="finance-excel">
        <header><span className="eyebrow">Previsión mensual</span><h2>Planeado contra real</h2></header>
        <div className="finance-table finance-table--summary"><div className="finance-table__head"><span>Concepto</span><span>Planeado</span><span>Real</span><span>Diferencia</span></div>
          {summary.map((row) => <div className="finance-table__row" key={row.label}><strong>{row.label}</strong><span data-label="Planeado">{formatMxn(row.planned)}</span><span data-label="Real">{formatMxn(row.actual)}</span><span data-label="Diferencia" className={row.difference >= 0 ? 'positive' : 'negative'}>{formatMxn(row.difference)}</span></div>)}
        </div>
      </section>
      <div className="finance-charts">
        <section><header><span className="eyebrow">Seis meses</span><h2>Ingresos vs gastos</h2></header><div className="finance-chart"><ResponsiveContainer><BarChart data={trend} accessibilityLayer><CartesianGrid stroke="#1d1d22" vertical={false} /><XAxis dataKey="month" stroke="#686870" axisLine={false} tickLine={false} /><YAxis stroke="#686870" axisLine={false} tickLine={false} width={42} tickFormatter={(value) => `$${Math.round(value / 1000)}k`} /><Tooltip formatter={(value) => formatMxn(Number(value) * 100)} contentStyle={{ background: '#111114', border: '1px solid #303038' }} /><Bar dataKey="ingresos" fill="#35c78a" radius={[3, 3, 0, 0]} /><Bar dataKey="gastos" fill="#315de3" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div></section>
        <section><header><span className="eyebrow">Distribución</span><h2>Gasto por categoría</h2></header>{categoryExpenses.length ? <div className="finance-chart"><ResponsiveContainer><PieChart accessibilityLayer><Pie data={categoryExpenses} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78}>{categoryExpenses.map((item, index) => <Cell key={item.name} fill={['#2457ff', '#35c78a', '#f4b740', '#a970ff', '#f05252'][index % 5]} />)}</Pie><Tooltip formatter={(value) => formatMxn(Number(value))} contentStyle={{ background: '#111114', border: '1px solid #303038' }} /></PieChart></ResponsiveContainer></div> : <EmptyState title="Sin gastos" description="No hay gastos completados en este periodo." />}</section>
      </div>
    </>}

    {panel === 'transactions' && <section className="finance-section">
      <div className="finance-toolbar"><input aria-label="Buscar movimientos" placeholder="Buscar…" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="Cuenta" value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}><option value="all">Todas las cuentas</option>{data.accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="Tipo" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">Todos los tipos</option>{Object.entries(typeLabel).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><select aria-label="Estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos los estados</option>{Object.entries(statusLabel).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
      <div className="finance-table finance-table--transactions"><div className="finance-table__head"><span>Fecha</span><span>Descripción</span><span>Categoría / cuenta</span><span>Estado</span><span>Monto</span><span>Acciones</span></div>
        {filteredTransactions.map((item, index) => <Fragment key={item.id}>
          {(index === 0 || filteredTransactions[index - 1]?.transactionDate !== item.transactionDate)
            && <div className="finance-date-group">{movementDateLabel(item.transactionDate)}</div>}
          <div className="finance-table__row">
            <time>{format(parseISO(item.transactionDate), 'dd MMM')}</time>
            <strong>{item.description}<small>{typeLabel[item.type]}</small></strong>
            <span>{data.categories.find((category) => category.id === item.categoryId)?.name ?? 'Transferencia'}<small>{data.accounts.find((account) => account.id === item.accountId)?.name}</small></span>
            <span><i className={`finance-status finance-status--${item.status}`} />{statusLabel[item.status]}</span>
            <b className={`finance-amount finance-amount--${item.type}`}>{item.type === 'income' || item.type === 'refund' ? '+' : item.type === 'transfer' ? '' : '−'}{formatMxn(item.amountCents)}</b>
            <nav>
              {item.status !== 'completed' && <button title="Marcar completado" aria-label="Marcar completado" onClick={() => void status(item, 'completed')}><Check size={14} /></button>}
              <button title="Editar movimiento" aria-label="Editar movimiento" onClick={() => { setEditingTransaction(item); setDialog('transaction') }}><Pencil size={14} /></button>
              <button title="Duplicar movimiento" aria-label="Duplicar movimiento" onClick={() => { setEditingTransaction({ ...item, id: crypto.randomUUID(), description: `${item.description} (copia)` }); setDialog('transaction') }}><Copy size={14} /></button>
              <button title="Cancelar movimiento" aria-label="Cancelar movimiento" disabled={item.status === 'cancelled'} onClick={() => void status(item, 'cancelled')}><Ban size={14} /></button>
              <button title="Eliminar definitivamente" aria-label="Eliminar definitivamente" onClick={() => setDeleting(item)}><Trash2 size={14} /></button>
            </nav>
          </div>
        </Fragment>)}
        {!filteredTransactions.length && <EmptyState title="Sin movimientos" description="Ajusta los filtros o registra el primer movimiento del periodo." />}
      </div>
    </section>}

    {panel === 'accounts' && <section className="finance-section">
      <SectionHead eyebrow="Estructura" title="Cuentas" action="Nueva cuenta" onClick={() => setDialog('account')} />
      <div className="finance-account-list">{data.accounts.map((account) => <article key={account.id} className={!account.isActive ? 'finance-account--archived' : ''}>
        <div><WalletCards /><strong>{account.name}</strong><small>{account.type} · {account.currency}{!account.isActive ? ' · archivada' : ''}</small></div>
        <span>Saldo calculado<strong>{formatMxn(accountBalance(account, data.transactions))}</strong></span>
        {account.type === 'credit' && <span>Límite<strong>{formatMxn(account.creditLimitCents ?? 0)}</strong></span>}
        <span>{account.closingDay ? `Corte ${account.closingDay}` : 'Sin corte'}<small>{account.paymentDay ? `Pago ${account.paymentDay}` : ''}</small></span>
        <nav>
          <Button variant="ghost" icon={<Pencil size={13} />} onClick={() => { setEditingAccount(account); setDialog('account') }}>Editar</Button>
          {account.isActive
            ? <Button variant="ghost" onClick={async () => { if (!user) return; await financeAccountRepository.archive(account.id, user.id); await finish('Cuenta archivada.') }}>Archivar</Button>
            : <><Button variant="ghost" icon={<RotateCcw size={13} />} onClick={async () => { if (!user) return; await financeAccountRepository.restore(account.id, user.id); await finish('Cuenta restaurada.') }}>Restaurar</Button><Button variant="ghost" icon={<Trash2 size={13} />} onClick={() => setDeletingAccount(account)}>Eliminar definitivamente</Button></>}
        </nav>
      </article>)}</div>
    </section>}

    {panel === 'budgets' && <section className="finance-section"><SectionHead eyebrow={format(month, 'MMMM yyyy', { locale: es })} title="Presupuesto por categoría" action="Definir presupuesto" onClick={() => setDialog('budget')} />{budgets.length ? <div className="finance-budget-list">{budgets.map((budget) => <article key={budget.id} className={budget.usedPercentage > 100 ? 'exceeded' : budget.usedPercentage >= 80 ? 'warning' : ''}><div><strong>{budget.category?.name}</strong><span>{formatMxn(budget.actualCents)} de {formatMxn(budget.plannedAmountCents)}</span></div><ProgressBar value={Math.min(100, budget.usedPercentage)} /><footer><span>{budget.usedPercentage.toFixed(0)}% utilizado</span><b>{formatMxn(budget.remainingCents)} restante</b></footer></article>)}</div> : <EmptyState title="Sin presupuesto" description="Define cuánto planeas gastar por categoría este mes." action={<Button onClick={() => setDialog('budget')}>Crear presupuesto</Button>} />}</section>}

    {panel === 'income' && <div className="finance-expenses-grid">
      <section className="finance-expense-panel">
        <SectionHead eyebrow="Entradas previsibles" title="Ingresos recurrentes" action="Registrar recurrente" onClick={() => { setMovementPreset({ type: 'income' }); setDialog('recurring') }} />
        <div className="finance-expense-list">{recurringForMonth.filter(({ item }) => item.type === 'income').map(({ item, expectedDate, occurrence }) => <RecurringCard key={item.id} item={item} expectedDate={expectedDate} occurrence={occurrence} account={data.accounts.find((account) => account.id === item.accountId)?.name} category={data.categories.find((category) => category.id === item.categoryId)?.name} busy={savingPaymentId === item.id} menuOpen={actionsFor === item.id} onToggleMenu={() => setActionsFor((current) => current === item.id ? undefined : item.id)} onRegister={() => void registerRecurringPayment(item)} onEdit={() => { setEditingRecurring(item); setDialog('recurring'); setActionsFor(undefined) }} onPostpone={() => void setRecurringMonthStatus(item, 'postponed')} onSkip={() => void setRecurringMonthStatus(item, 'skipped')} onToggleActive={async () => { if (!user) return; await financeRecurringRepository.setActive(item.id, !item.isActive, user.id); setActionsFor(undefined); await finish(item.isActive ? 'Ingreso pausado.' : 'Ingreso reanudado.') }} onDelete={() => { setDeletingRecurring(item); setActionsFor(undefined) }} onRevert={() => occurrence && setRevertingOccurrence(occurrence)} />)}</div>
        {!recurringForMonth.some(({ item }) => item.type === 'income') && <EmptyState title="Sin ingresos recurrentes" description="Registra sueldo, honorarios o pagos periódicos esperados." />}
      </section>
      <section className="finance-expense-panel">
        <SectionHead eyebrow="Entradas extraordinarias" title="Ingresos eventuales" action="Registrar eventual" onClick={() => startMovement({ type: 'income', status: 'planned' })} />
        <div className="finance-expense-list">{monthlyTransactions.filter((item) => ['planned', 'pending'].includes(item.status) && (item.type === 'income' || item.type === 'refund')).map((item) => <article key={item.id}><header><div><strong>{item.description}</strong><small>{item.transactionDate} · {item.status === 'planned' ? 'Esperado' : 'Pospuesto'}</small></div><b className="positive">{formatMxn(item.amountCents)}</b></header><small>{data.accounts.find((account) => account.id === item.accountId)?.name} · {data.categories.find((category) => category.id === item.categoryId)?.name}</small><footer><Button disabled={savingPaymentId === item.id} onClick={() => void registerEventualPayment(item)}>{savingPaymentId === item.id ? 'Registrando…' : 'Registrar cobro'}</Button><Button variant="ghost" onClick={() => { setEditingTransaction(item); setDialog('transaction') }}>Editar</Button><Button variant="ghost" onClick={() => void status(item, 'pending')}>Posponer</Button><Button variant="ghost" onClick={() => void status(item, 'cancelled')}>Cancelar</Button></footer></article>)}</div>
        {!monthlyTransactions.some((item) => ['planned', 'pending'].includes(item.status) && (item.type === 'income' || item.type === 'refund')) && <EmptyState title="Sin ingresos eventuales" description="Planea bonos, ventas o pagos extraordinarios sin afectar el saldo real." />}
      </section>
    </div>}

    {panel === 'recurring' && <div className="finance-expenses-grid">
      <section className="finance-expense-panel">
        <SectionHead eyebrow="Calendario financiero" title="Gastos recurrentes" action="Registrar recurrente" onClick={() => setDialog('recurring')} />
        <div className="finance-expense-list">{recurringForMonth.filter(({ item }) => item.type !== 'income' && item.type !== 'refund').map(({ item, expectedDate, occurrence }) => <RecurringCard key={item.id} item={item} expectedDate={expectedDate} occurrence={occurrence} account={data.accounts.find((account) => account.id === item.accountId)?.name} category={data.categories.find((category) => category.id === item.categoryId)?.name} busy={savingPaymentId === item.id} menuOpen={actionsFor === item.id} onToggleMenu={() => setActionsFor((current) => current === item.id ? undefined : item.id)} onRegister={() => void registerRecurringPayment(item)} onEdit={() => { setEditingRecurring(item); setDialog('recurring'); setActionsFor(undefined) }} onPostpone={() => void setRecurringMonthStatus(item, 'postponed')} onSkip={() => void setRecurringMonthStatus(item, 'skipped')} onToggleActive={async () => { if (!user) return; await financeRecurringRepository.setActive(item.id, !item.isActive, user.id); setActionsFor(undefined); await finish(item.isActive ? 'Recurrente pausado.' : 'Recurrente reanudado.') }} onDelete={() => { setDeletingRecurring(item); setActionsFor(undefined) }} onRevert={() => occurrence && setRevertingOccurrence(occurrence)} />)}</div>
        {!recurringForMonth.some(({ item }) => item.type !== 'income' && item.type !== 'refund') && <EmptyState title="Sin gastos recurrentes" description="Registra renta, servicios o cualquier gasto periódico." />}
      </section>
      <section className="finance-expense-panel">
        <SectionHead eyebrow="Una sola ocasión" title="Gastos eventuales" action="Registrar eventual" onClick={() => startMovement({ type: 'expense', status: 'planned' })} />
        <div className="finance-expense-list">{monthlyTransactions.filter((item) => !item.recurringTransactionId && (item.type === 'expense' || item.type === 'debt_payment')).sort((a, b) => {
          const rank = (status: FinanceTransactionStatus) => status === 'planned' ? 0 : status === 'pending' ? 1 : 2
          return rank(a.status) - rank(b.status) || a.transactionDate.localeCompare(b.transactionDate)
        }).map((item) => <article key={item.id}>
          <header><div><strong>{item.description}</strong><small>{item.transactionDate} · {item.status === 'completed' ? 'Pagado' : item.status === 'pending' ? 'Pospuesto' : statusLabel[item.status]}</small></div><b>{formatMxn(item.amountCents)}</b></header>
          <span className={`finance-occurrence-status finance-occurrence-status--${item.status === 'completed' ? 'paid' : item.status}`}>{item.status === 'completed' ? 'Pagado' : item.status === 'pending' ? 'Pospuesto' : statusLabel[item.status]}</span>
          <footer>
            <Button disabled={item.status !== 'planned' || savingPaymentId === item.id} onClick={() => void registerEventualPayment(item)}>{item.status === 'completed' ? 'Pagado' : savingPaymentId === item.id ? 'Registrando…' : 'Registrar pago'}</Button>
            <Button variant="ghost" onClick={() => { setEditingTransaction(item); setDialog('transaction') }}>Editar</Button>
            {item.status === 'planned' && <Button variant="ghost" onClick={() => void status(item, 'pending')}>Posponer</Button>}
            {!['completed', 'cancelled'].includes(item.status) && <Button variant="ghost" onClick={() => void status(item, 'cancelled')}>Cancelar</Button>}
          </footer>
        </article>)}</div>
        {!monthlyTransactions.some((item) => !item.recurringTransactionId && (item.type === 'expense' || item.type === 'debt_payment')) && <EmptyState title="Sin gastos eventuales" description="Planea una compra o pago futuro sin afectar todavía tu saldo real." />}
      </section>
    </div>}

    {panel === 'savings' && <SavingsPanel metrics={metrics} annual={annualTotals} year={month.getFullYear()} />}

    {panel === 'goals' && <section className="finance-section"><SectionHead eyebrow="Dirección" title="Metas financieras" action="Nueva meta" onClick={() => setDialog('goal')} /><div className="finance-goals">{data.goals.map((goal) => { const progress = goalProgress(goal.id, data); return <article key={goal.id}><header><Target /><div><strong>{goal.name}</strong><small>{goal.priority} · {goal.status}</small></div><b>{progress.percentage.toFixed(0)}%</b></header><ProgressBar value={progress.percentage} /><div><span>Ahorrado<strong>{formatMxn(progress.savedCents)}</strong></span><span>Restante<strong>{formatMxn(progress.remainingCents)}</strong></span><span>Objetivo<strong>{formatMxn(goal.targetAmountCents)}</strong></span></div><footer><Button variant="secondary" onClick={() => { setSelectedGoal(goal); setDialog('contribution') }}>Registrar aportación</Button><Button variant="ghost" onClick={() => { setEditingGoal(goal); setDialog('goal') }}>Editar</Button>{goal.status === 'active' && <Button variant="ghost" onClick={async () => { if (!user) return; await financeGoalRepository.save({ ...goal, status: 'paused' }, user.id); await finish('Meta pausada.') }}>Pausar</Button>}{progress.percentage >= 100 && goal.status !== 'completed' && <Button variant="ghost" onClick={async () => { if (!user) return; await financeGoalRepository.save({ ...goal, status: 'completed' }, user.id); await finish('Meta completada.') }}>Completar</Button>}</footer></article> })}</div>{!data.goals.length && <EmptyState title="Sin metas financieras" description="Convierte una intención de ahorro en una dirección medible." />}</section>}
    </div>

    {dialog === 'movementMenu' && <MovementMenu canTransfer={activeAccounts.length > 1} onClose={() => setDialog(null)} onSelect={startMovement} />}
    {dialog === 'transaction' && <TransactionDialog initial={editingTransaction} preset={movementPreset} accounts={data.accounts.filter((item) => item.isActive)} categories={data.categories.filter((item) => item.isActive)} onClose={() => { setDialog(null); setEditingTransaction(undefined); setMovementPreset(undefined) }} onSave={async (item) => { if (!user) return; await financeTransactionRepository.save(item, user.id); setMovementPreset(undefined); await finish('Movimiento guardado.') }} />}
    {dialog === 'account' && <AccountDialog initial={editingAccount} onClose={() => { setDialog(null); setEditingAccount(undefined) }} onSave={async (item) => { if (!user) return; await financeAccountRepository.save(item, user.id); await finish('Cuenta guardada.') }} />}
    {dialog === 'budget' && <BudgetDialog month={monthKey(month)} categories={data.categories.filter((item) => item.type === 'expense' && item.isActive)} onClose={() => setDialog(null)} onSave={async (item) => { if (!user) return; await financeBudgetRepository.save(item, user.id); await finish('Presupuesto guardado.') }} />}
    {dialog === 'recurring' && <RecurringDialog
      initial={editingRecurring}
      occurrence={editingRecurring ? data.recurringOccurrences.find((item) => item.recurringTransactionId === editingRecurring.id && item.period === selectedPeriod) : undefined}
      period={selectedPeriod}
      suggestedDate={editingRecurring ? recurringExpectedDate(editingRecurring, month) : format(month, 'yyyy-MM-dd')}
      presetType={movementPreset?.type}
      accounts={data.accounts.filter((item) => item.isActive)}
      categories={data.categories.filter((item) => item.isActive)}
      onClose={() => { setDialog(null); setEditingRecurring(undefined); setMovementPreset(undefined) }}
      onSave={async (item) => {
        if (!user) return
        if (editingRecurring) {
          await financeRecurringOccurrenceRepository.savePeriod(item.id, selectedPeriod, item.nextOccurrence, item.amountCents, user.id)
        } else {
          await financeRecurringRepository.save(item, user.id)
          await financeRecurringOccurrenceRepository.savePeriod(item.id, selectedPeriod, item.nextOccurrence, item.amountCents, user.id)
        }
        setMovementPreset(undefined)
        await finish(editingRecurring ? 'Periodo recurrente actualizado.' : 'Movimiento recurrente guardado.')
      }}
    />}
    {dialog === 'goal' && <GoalDialog initial={editingGoal} accounts={data.accounts.filter((item) => item.isActive)} onClose={() => { setDialog(null); setEditingGoal(undefined) }} onSave={async (item) => { if (!user) return; await financeGoalRepository.save(item, user.id); await finish('Meta guardada.') }} />}
    {dialog === 'contribution' && selectedGoal && <ContributionDialog goal={selectedGoal} accounts={data.accounts.filter((item) => item.isActive)} onClose={() => { setDialog(null); setSelectedGoal(undefined) }} onSave={async (item) => { if (!user) return; await financeGoalRepository.contribute(item, user.id); await finish('Aportación registrada.') }} />}
    <ConfirmDialog open={Boolean(deleting)} title="Eliminar movimiento" description="Esta acción elimina el movimiento definitivamente y recalcula los saldos. ¿Deseas continuar?" onClose={() => setDeleting(undefined)} onConfirm={async () => { if (!user || !deleting) return; await financeTransactionRepository.remove(deleting.id, user.id); setDeleting(undefined); await finish('Movimiento eliminado.') }} />
    <ConfirmDialog open={Boolean(deletingAccount)} title="Eliminar cuenta definitivamente" description="Solo se eliminará si no tiene movimientos ni relaciones. Si conserva historial, FARO bloqueará la operación y la cuenta permanecerá archivada." onClose={() => setDeletingAccount(undefined)} onConfirm={async () => {
      if (!user || !deletingAccount) return
      try {
        await financeAccountRepository.remove(deletingAccount.id, user.id)
        setDeletingAccount(undefined)
        await finish('Cuenta eliminada.')
      } catch (reason) {
        setDeletingAccount(undefined)
        setFeedback(reason instanceof Error ? reason.message : 'No se pudo eliminar la cuenta.')
      }
    }} />
    <ConfirmDialog open={Boolean(deletingRecurring)} title="Eliminar recurrente" description="Esta acción eliminará la programación futura. Los movimientos ya registrados permanecerán en tu historial." confirmLabel="Eliminar" onClose={() => setDeletingRecurring(undefined)} onConfirm={async () => {
      if (!user || !deletingRecurring) return
      try {
        await financeRecurringRepository.remove(deletingRecurring.id, user.id)
        setDeletingRecurring(undefined)
        await finish('Programación recurrente eliminada.')
      } catch (reason) {
        setDeletingRecurring(undefined)
        setFeedback(reason instanceof Error ? reason.message : 'No se pudo eliminar el recurrente.')
      }
    }} />
    <ConfirmDialog open={Boolean(revertingOccurrence)} title={revertingOccurrence && data.recurring.find((item) => item.id === revertingOccurrence.recurringTransactionId)?.type === 'income' ? 'Deshacer cobro' : 'Deshacer pago'} description={revertingOccurrence && data.recurring.find((item) => item.id === revertingOccurrence.recurringTransactionId)?.type === 'income' ? 'Se eliminará el movimiento generado y el ingreso volverá a su estado anterior.' : 'Se eliminará el movimiento generado y el gasto volverá a su estado anterior.'} confirmLabel="Deshacer" onClose={() => setRevertingOccurrence(undefined)} onConfirm={() => void revertRecurringPayment()} />
  </div>
}

function RecurringCard({ item, expectedDate, occurrence, account, category, busy, menuOpen, onToggleMenu, onRegister, onEdit, onPostpone, onSkip, onToggleActive, onDelete, onRevert }: {
  item: FinanceRecurringTransaction
  expectedDate?: string
  occurrence?: FinanceRecurringOccurrence
  account?: string
  category?: string
  busy: boolean
  menuOpen: boolean
  onToggleMenu: () => void
  onRegister: () => void
  onEdit: () => void
  onPostpone: () => void
  onSkip: () => void
  onToggleActive: () => void
  onDelete: () => void
  onRevert: () => void
}) {
  const income = item.type === 'income'
  const paid = occurrence?.status === 'paid'
  const configured = Boolean(occurrence?.amountCents && expectedDate)
  const frequency = financeFrequencyLabel[item.frequency]
  return <article className={`finance-expense--${occurrence?.status ?? 'pending'} ${!item.isActive ? 'finance-expense--paused' : ''}`}>
    <header><Repeat2 /><div><strong>{item.description}</strong><small>{configured ? `${frequency} · ${formatFinanceDate(expectedDate!)}` : `${frequency} · monto y fecha por definir`}</small></div><b className={income ? 'positive' : ''}>{configured ? formatMxn(occurrence!.amountCents!) : '—'}</b></header>
    <small>{account}{category ? ` · ${category}` : ''}</small>
    <span className={`finance-occurrence-status finance-occurrence-status--${occurrence?.status ?? 'pending'}`}>{!item.isActive ? 'Pausado' : paid ? income ? 'Cobrado' : 'Pagado' : occurrence?.status === 'skipped' ? 'Omitido' : occurrence?.status === 'postponed' ? 'Pospuesto' : income ? 'Esperado' : 'Pendiente'}</span>
    <footer>
      {paid
        ? <Button variant="secondary" disabled={busy} onClick={onRevert}>{income ? 'Deshacer cobro' : 'Deshacer pago'}</Button>
        : <Button disabled={!item.isActive || !configured || occurrence?.status === 'skipped' || busy} loading={busy} onClick={onRegister}>{income ? 'Registrar cobro' : 'Registrar pago'}</Button>}
      <Button variant="ghost" onClick={onEdit}>{configured ? 'Editar periodo' : 'Definir periodo'}</Button>
      <div className="finance-card-menu">
        <button aria-label={`Más acciones para ${item.description}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={onToggleMenu}><MoreHorizontal size={17} /></button>
        {menuOpen && <div role="menu"><button role="menuitem" disabled={paid || busy} onClick={onPostpone}>Posponer</button><button role="menuitem" disabled={paid || busy} onClick={onSkip}>Saltar periodo</button><button role="menuitem" onClick={onToggleActive}>{item.isActive ? 'Pausar' : 'Reanudar'}</button><button role="menuitem" className="danger" onClick={onDelete}>Eliminar</button></div>}
      </div>
    </footer>
  </article>
}

function FinanceMetrics({ metrics, previous, hasPreviousData }: {
  metrics: ReturnType<typeof calculateFinanceMetrics>
  previous: ReturnType<typeof calculateFinanceMetrics>
  hasPreviousData: boolean
}) {
  return <section className="finance-kpis finance-kpis--primary" aria-label="Métricas financieras del periodo">
    <FinanceKpi featured icon={<Landmark />} label="Disponible operativo" value={metrics.availableBalanceCents} context="Dinero disponible en cuentas activas" />
    <FinanceKpi icon={<ArrowUpRight />} label="Ingresos del periodo" value={metrics.monthlyIncomeCents} previous={previous.monthlyIncomeCents} hasPrevious={hasPreviousData} />
    <FinanceKpi icon={<ArrowDownRight />} label="Gastos del periodo" value={metrics.monthlyExpensesCents} previous={previous.monthlyExpensesCents} hasPrevious={hasPreviousData} inverse />
    <FinanceKpi label="Balance proyectado" value={metrics.projectedBalanceCents} context="Saldo real + ingresos pendientes − gastos pendientes" />
    <FinanceKpi label="Balance real" value={metrics.actualBalanceCents} context="Saldo actual de todas tus cuentas" />
  </section>
}

function SavingsPanel({ metrics, annual, year }: {
  metrics: ReturnType<typeof calculateFinanceMetrics>
  annual: ReturnType<typeof annualFinanceTotals>
  year: number
}) {
  return <section className="finance-savings-panel">
    <header><span className="eyebrow">Capital y acumulados</span><h2>Ahorro</h2><p>Seguimiento del ahorro del periodo y del flujo anual completado.</p></header>
    <div className="finance-savings-kpis">
      <FinanceKpi icon={<PiggyBank />} label="Ahorro del periodo" value={metrics.monthlySavingsCents} context="Movimientos de ahorro completados" />
      <FinanceKpi label="Tasa de ahorro" text={`${metrics.savingsRate.toFixed(1)}%`} context="Ahorro del periodo ÷ ingresos del periodo" />
    </div>
    <section className="finance-annual-kpis" aria-label={`Acumulados financieros de ${year}`}>
      <FinanceKpi icon={<ArrowUpRight />} label={`Ingresos acumulados ${year}`} value={annual.incomeCents} context="Movimientos completados" />
      <FinanceKpi icon={<ArrowDownRight />} label={`Gastos acumulados ${year}`} value={annual.expenseCents} context="Sin transferencias ni ahorro" />
      <FinanceKpi label={`Balance anual ${year}`} value={annual.netCents} context="Ingresos acumulados − gastos acumulados" />
    </section>
  </section>
}

function FinanceKpi({ icon, label, value, previous, inverse, text, featured, hasPrevious, context }: { icon?: React.ReactNode; label: string; value?: number; previous?: number; inverse?: boolean; text?: string; featured?: boolean; hasPrevious?: boolean; context?: string }) {
  const delta = hasPrevious && previous != null && value != null ? value - previous : null
  const good = delta == null || (inverse ? delta <= 0 : delta >= 0)
  return <article className={featured ? 'finance-kpi--featured' : ''}>{icon}<span>{label}</span><strong>{text ?? formatMxn(value ?? 0)}</strong>{context ? <small>{context}</small> : hasPrevious ? <small className={good ? 'positive' : 'negative'}>{delta === 0 ? 'Sin cambio' : `${(delta ?? 0) > 0 ? '+' : ''}${formatMxn(delta ?? 0)} vs anterior`}</small> : previous != null && <small>Sin datos del periodo anterior</small>}</article>
}
function SectionHead({ eyebrow, title, action, onClick }: { eyebrow: string; title: string; action: string; onClick: () => void }) {
  return <header className="finance-section__head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><Button icon={<Plus size={14} />} onClick={onClick}>{action}</Button></header>
}
function moneyToCents(value: string) { return Math.round(Number(value) * 100) }
function ErrorText({ value }: { value: string }) { return value ? <p className="finance-form-error" role="alert">{value}</p> : null }
function movementDateLabel(value: string) {
  const date = parseISO(value)
  const today = new Date()
  if (isSameDay(date, today)) return 'Hoy'
  if (isSameDay(date, addDays(today, -1))) return 'Ayer'
  return format(date, 'EEEE d MMMM', { locale: es })
}

function MovementMenu({ canTransfer, onClose, onSelect }: { canTransfer: boolean; onClose: () => void; onSelect: (preset: MovementPreset) => void }) {
  const options: Array<[string, MovementPreset, string]> = [
    ['Registrar ingreso', { type: 'income', categoryName: 'Sueldo' }, 'Dinero que entra'],
    ['Registrar gasto', { type: 'expense' }, 'Gasto fijo o variable'],
    ['Registrar ahorro', { type: 'saving', categoryName: 'Ahorro' }, 'Separar dinero para ahorrar'],
    ['Registrar inversión', { type: 'saving', categoryName: 'Inversión' }, 'Se registra como flujo de ahorro'],
    ['Transferencia', { type: 'transfer' }, 'Mover dinero entre cuentas'],
  ]
  return <Modal open title="Nuevo movimiento" onClose={onClose}><div className="finance-movement-menu">{options.map(([label, preset, description]) => { const disabled = preset.type === 'transfer' && !canTransfer; return <button key={label} disabled={disabled} title={disabled ? 'Necesitas al menos dos cuentas activas para mover dinero entre ellas.' : undefined} onClick={() => onSelect(preset)}><span>{label}</span><small>{disabled ? 'Crea o restaura otra cuenta para transferir' : description}</small><ArrowRight size={15} /></button> })}</div></Modal>
}

function TransactionDialog({ initial, preset, accounts, categories, onClose, onSave }: { initial?: FinanceTransaction; preset?: MovementPreset; accounts: FinanceAccount[]; categories: { id: string; name: string; type: string }[]; onClose: () => void; onSave: (item: Omit<FinanceTransaction, 'createdAt' | 'updatedAt'>) => Promise<void> }) {
  const [type, setType] = useState<FinanceTransactionType>(initial?.type ?? preset?.type ?? 'expense')
  const [amount, setAmount] = useState(initial ? String(initial.amountCents / 100) : '')
  const [date, setDate] = useState(initial?.transactionDate ?? format(new Date(), 'yyyy-MM-dd'))
  const [description, setDescription] = useState(initial?.description ?? '')
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? '')
  const [destinationAccountId, setDestinationAccountId] = useState(initial?.destinationAccountId ?? '')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories.find((item) => item.name === preset?.categoryName)?.id ?? '')
  const [status, setStatus] = useState<FinanceTransactionStatus>(initial?.status ?? preset?.status ?? 'completed')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const result = financeTransactionSchema.safeParse({ type, amountCents: moneyToCents(amount), transactionDate: date, description, accountId, destinationAccountId: destinationAccountId || undefined, categoryId: categoryId || undefined, status, notes: notes || undefined })
    if (!result.success) return setError(result.error.issues[0]?.message ?? 'Revisa los campos.')
    setSaving(true); setError('')
    try { await onSave({ id: initial?.id ?? crypto.randomUUID(), ...result.data, legacyTransactionId: initial?.legacyTransactionId }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar.') }
    finally { setSaving(false) }
  }
  const matchingCategories = categories.filter((item) => item.type === (type === 'income' || type === 'refund' ? 'income' : type === 'saving' ? 'saving' : type === 'debt_payment' ? 'debt' : 'expense'))
  return <Modal open title={initial ? 'Editar movimiento' : 'Nuevo movimiento'} onClose={onClose}><form className="finance-form" onSubmit={submit}><div className="finance-form-grid"><label>Tipo<select value={type} onChange={(event) => { setType(event.target.value as FinanceTransactionType); setCategoryId('') }}>{Object.entries(typeLabel).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Monto MXN<input type="number" min=".01" step=".01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label></div><label>Descripción<input autoFocus required maxLength={160} value={description} onChange={(event) => setDescription(event.target.value)} /></label><div className="finance-form-grid"><label>Fecha<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Estado<select value={status} onChange={(event) => setStatus(event.target.value as FinanceTransactionStatus)}>{Object.entries(statusLabel).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div><label>Cuenta<select required value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Selecciona</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{type === 'transfer' ? <label>Cuenta destino<select required value={destinationAccountId} onChange={(event) => setDestinationAccountId(event.target.value)}><option value="">Selecciona</option>{accounts.filter((item) => item.id !== accountId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <label>Categoría<select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Selecciona</option>{matchingCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<label>Notas<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label><p className="privacy-note">No ingreses números de cuenta, tarjeta ni credenciales bancarias.</p><ErrorText value={error} /><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button></div></form></Modal>
}

function AccountDialog({ initial, onClose, onSave }: { initial?: FinanceAccount; onClose: () => void; onSave: (item: Omit<FinanceAccount, 'createdAt' | 'updatedAt'>) => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? ''); const [type, setType] = useState<FinanceAccount['type']>(initial?.type ?? 'checking')
  const [balance, setBalance] = useState(initial ? String(initial.initialBalanceCents / 100) : ''); const [limit, setLimit] = useState(initial?.creditLimitCents == null ? '' : String(initial.creditLimitCents / 100))
  const [closingDay, setClosingDay] = useState(initial?.closingDay ? String(initial.closingDay) : ''); const [paymentDay, setPaymentDay] = useState(initial?.paymentDay ? String(initial.paymentDay) : '')
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => { event.preventDefault(); const result = financeAccountSchema.safeParse({ name, type, initialBalanceCents: moneyToCents(balance || '0'), creditLimitCents: limit ? moneyToCents(limit) : undefined, closingDay: closingDay ? Number(closingDay) : undefined, paymentDay: paymentDay ? Number(paymentDay) : undefined }); if (!result.success) return setError(result.error.issues[0]?.message ?? 'Revisa los campos.'); setSaving(true); try { await onSave({ id: initial?.id ?? crypto.randomUUID(), ...result.data, currency: initial?.currency ?? 'MXN', isActive: initial?.isActive ?? true }) } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar.') } finally { setSaving(false) } }
  return <Modal open title={initial ? 'Editar cuenta' : 'Nueva cuenta'} onClose={onClose}><form className="finance-form" onSubmit={submit}><label>Nombre<input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. BBVA Débito" /></label><div className="finance-form-grid"><label>Tipo<select value={type} onChange={(event) => setType(event.target.value as FinanceAccount['type'])}><option value="cash">Efectivo</option><option value="checking">Débito</option><option value="savings">Ahorro</option><option value="credit">Crédito</option><option value="investment">Inversión</option><option value="loan">Préstamo</option></select></label><label>Saldo inicial MXN<input type="number" step=".01" value={balance} onChange={(event) => setBalance(event.target.value)} /></label></div>{type === 'credit' && <><label>Límite de crédito<input type="number" min="0" step=".01" value={limit} onChange={(event) => setLimit(event.target.value)} /></label><div className="finance-form-grid"><label>Día de corte<input type="number" min="1" max="31" value={closingDay} onChange={(event) => setClosingDay(event.target.value)} /></label><label>Día de pago<input type="number" min="1" max="31" value={paymentDay} onChange={(event) => setPaymentDay(event.target.value)} /></label></div></>}<ErrorText value={error} /><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}>Guardar</Button></div></form></Modal>
}

function BudgetDialog({ month, categories, onClose, onSave }: { month: string; categories: { id: string; name: string }[]; onClose: () => void; onSave: (item: { categoryId: string; month: string; plannedAmountCents: number }) => Promise<void> }) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? ''); const [amount, setAmount] = useState(''); const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); const result = financeBudgetSchema.safeParse({ categoryId, month, plannedAmountCents: moneyToCents(amount) }); if (!result.success) return setError(result.error.issues[0]?.message ?? 'Revisa los campos.'); try { await onSave(result.data) } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar.') } }
  return <Modal open title="Presupuesto mensual" onClose={onClose}><form className="finance-form" onSubmit={submit}><label>Categoría<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Planeado MXN<input autoFocus type="number" min="0" step=".01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label><ErrorText value={error} /><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar</Button></div></form></Modal>
}

function RecurringDialog({ initial, occurrence, period, suggestedDate, presetType, accounts, categories, onClose, onSave }: {
  initial?: FinanceRecurringTransaction
  occurrence?: FinanceRecurringOccurrence
  period: string
  suggestedDate: string
  presetType?: FinanceTransactionType
  accounts: FinanceAccount[]
  categories: { id: string; name: string; type: string }[]
  onClose: () => void
  onSave: (item: Omit<FinanceRecurringTransaction, 'createdAt' | 'updatedAt'>) => Promise<void>
}) {
  const [description, setDescription] = useState(initial?.description ?? '')
  const [amount, setAmount] = useState(occurrence?.amountCents ? String(occurrence.amountCents / 100) : '')
  const [type, setType] = useState<FinanceTransactionType>(initial?.type ?? presetType ?? 'expense')
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? '')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '')
  const [frequency, setFrequency] = useState<FinanceRecurringTransaction['frequency']>(initial?.frequency ?? 'monthly')
  const [date, setDate] = useState(occurrence?.expectedDate ?? suggestedDate)
  const [error, setError] = useState('')
  const periodLabel = format(parseISO(period), 'MMMM yyyy', { locale: es })
  const periodEnd = format(endOfMonth(parseISO(period)), 'yyyy-MM-dd')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!description.trim() || moneyToCents(amount) <= 0 || !accountId || !categoryId) return setError('Completa los campos obligatorios.')
    try {
      await onSave({
        id: initial?.id ?? crypto.randomUUID(), description: description.trim(),
        amountCents: moneyToCents(amount), type, accountId, categoryId, frequency,
        startDate: initial?.startDate ?? date, nextOccurrence: date,
        isActive: initial?.isActive ?? true, endDate: initial?.endDate,
        dayOfMonth: initial?.dayOfMonth,
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar.')
    }
  }
  if (initial) {
    return <Modal open title={`Configurar ${periodLabel}`} onClose={onClose}><form className="finance-form" onSubmit={submit}>
      <label>Concepto<input value={description} readOnly /></label>
      <div className="finance-form-grid">
        <label>Importe MXN<input autoFocus required type="number" min=".01" step=".01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label>Fecha del periodo<input required type="date" min={period} max={periodEnd} value={date} onChange={(event) => setDate(event.target.value)} /></label>
      </div>
      <p className="finance-form-hint">Este monto y esta fecha sólo se aplican a {periodLabel}. Los demás meses no cambiarán.</p>
      <ErrorText value={error} /><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar periodo</Button></div>
    </form></Modal>
  }
  return <Modal open title="Nuevo recurrente" onClose={onClose}><form className="finance-form" onSubmit={submit}>
    <label>Concepto<input autoFocus required value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <div className="finance-form-grid"><label>Tipo<select value={type} onChange={(event) => { setType(event.target.value as FinanceTransactionType); setCategoryId('') }}><option value="income">Ingreso</option><option value="expense">Gasto</option><option value="saving">Ahorro</option><option value="debt_payment">Pago de deuda</option></select></label><label>Importe de {periodLabel}<input type="number" min=".01" step=".01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label></div>
    <label>Cuenta<select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>Categoría<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Selecciona</option>{categories.filter((item) => item.type === (type === 'income' ? 'income' : type === 'saving' ? 'saving' : type === 'debt_payment' ? 'debt' : 'expense')).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <div className="finance-form-grid"><label>Frecuencia<select value={frequency} onChange={(event) => setFrequency(event.target.value as FinanceRecurringTransaction['frequency'])}><option value="weekly">Semanal</option><option value="biweekly">Quincenal</option><option value="monthly">Mensual</option><option value="quarterly">Trimestral</option><option value="yearly">Anual</option></select></label><label>Fecha de {periodLabel}<input type="date" min={period} max={periodEnd} value={date} onChange={(event) => setDate(event.target.value)} /></label></div>
    <ErrorText value={error} /><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar</Button></div>
  </form></Modal>
}

function GoalDialog({ initial, accounts, onClose, onSave }: { initial?: FinanceGoal; accounts: FinanceAccount[]; onClose: () => void; onSave: (item: Omit<FinanceGoal, 'createdAt' | 'updatedAt'>) => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? ''); const [amount, setAmount] = useState(initial ? String(initial.targetAmountCents / 100) : ''); const [date, setDate] = useState(initial?.targetDate ?? ''); const [priority, setPriority] = useState<FinanceGoal['priority']>(initial?.priority ?? 'medium'); const [accountId, setAccountId] = useState(initial?.linkedAccountId ?? ''); const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); const result = financeGoalSchema.safeParse({ name, targetAmountCents: moneyToCents(amount), targetDate: date || undefined, priority, linkedAccountId: accountId || undefined }); if (!result.success) return setError(result.error.issues[0]?.message ?? 'Revisa los campos.'); try { await onSave({ id: initial?.id ?? crypto.randomUUID(), ...result.data, description: initial?.description, status: initial?.status ?? 'active' }) } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar.') } }
  return <Modal open title={initial ? 'Editar meta financiera' : 'Nueva meta financiera'} onClose={onClose}><form className="finance-form" onSubmit={submit}><label>Nombre<input autoFocus required value={name} onChange={(event) => setName(event.target.value)} /></label><label>Monto objetivo MXN<input type="number" min=".01" step=".01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><div className="finance-form-grid"><label>Fecha objetivo<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Prioridad<select value={priority} onChange={(event) => setPriority(event.target.value as FinanceGoal['priority'])}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label></div><label>Cuenta vinculada<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Ninguna</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><ErrorText value={error} /><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar</Button></div></form></Modal>
}

function ContributionDialog({ goal, accounts, onClose, onSave }: { goal: FinanceGoal; accounts: FinanceAccount[]; onClose: () => void; onSave: (item: { id: string; goalId: string; accountId?: string; amountCents: number; contributionDate: string; contributionSource: 'from_account' | 'previously_reserved'; description?: string; notes?: string }) => Promise<void> }) {
  const [source, setSource] = useState<'from_account' | 'previously_reserved'>('from_account'); const [amount, setAmount] = useState(''); const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd')); const [accountId, setAccountId] = useState(goal.linkedAccountId ?? accounts[0]?.id ?? ''); const [description, setDescription] = useState(''); const [notes, setNotes] = useState(''); const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); if (moneyToCents(amount) <= 0) return setError('El importe debe ser mayor que cero.'); if (source === 'from_account' && !accountId) return setError('Selecciona una cuenta de origen.'); try { await onSave({ id: crypto.randomUUID(), goalId: goal.id, accountId: source === 'from_account' ? accountId : undefined, amountCents: moneyToCents(amount), contributionDate: date, contributionSource: source, description: description || undefined, notes: notes || undefined }) } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar.') } }
  return <Modal open title={`Aportación · ${goal.name}`} onClose={onClose}><form className="finance-form" onSubmit={submit}><label>Origen de la aportación<select value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="from_account">Descontar de una cuenta</option><option value="previously_reserved">Ya estaba apartado anteriormente</option></select></label><label>Importe MXN<input autoFocus type="number" min=".01" step=".01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label>Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>{source === 'from_account' && <><label>Cuenta origen<select required value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Selecciona</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Descripción<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={`Aportación a ${goal.name}`} /></label></>}<label>Notas<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label><ErrorText value={error} /><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">Registrar</Button></div></form></Modal>
}
