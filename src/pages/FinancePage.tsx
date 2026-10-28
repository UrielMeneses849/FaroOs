import './finance-mobile.css'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { addDays, addMonths, endOfMonth, format, isSameDay, parseISO, subMonths } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight,
  Ban, Calculator, CalendarDays, ChartNoAxesCombined, Check, Clock3, Copy, FileDown, FileUp, Landmark, Pencil, PiggyBank, Plus, RefreshCw, Repeat2,
  RotateCcw, Target, Trash2, WalletCards, House, Ellipsis, Search,
} from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button, ConfirmDialog, EmptyState, Modal, ProgressBar } from '../components/common'
import { PageHeader } from '../components/layout'
import { ExpenseCategoryDonut } from '../features/finance/ExpenseCategoryDonut'
import { FinanceLiquidityRadar } from '../features/finance/FinanceLiquidityRadar'
import { SharedReceiptDialog } from '../features/finance/SharedReceiptDialog'
import { FinanceNavigation } from '../features/finance/FinanceNavigation'
import { FinanceCategoryManager, FundEntryEditor, ReservedContributionEditor } from '../features/finance/FinanceRecordDialogs'
import { FinanceList } from '../features/finance/FinanceList'
import { DebtPlanPanel } from '../features/finance/DebtPlanPanel'
import { DebtMovementFields, DebtPicker } from '../features/finance/DebtMovementFields'
import { debtPlanBalanceCents } from '../services/debtPlanBalance'
import type { FinanceDebt } from '../features/finance/debtTypes'
import {
  financeAccountSchema, financeBudgetSchema, financeGoalSchema, financeTransactionSchema,
} from '../features/finance/financeSchemas'
import type {
  FinanceAccount, FinanceBudget, FinanceCategory, FinanceCategoryType, FinanceData, FinanceGoal, FinanceGoalContribution, FinanceGoalItem, FinanceRecurringOccurrence, FinanceRecurringTransaction, FinanceSavingsFundEntry, FinanceTransaction,
  FinanceTransactionStatus, FinanceTransactionType,
} from '../features/finance/financeTypes'
import { useFinance } from '../hooks/useFinance'
import {
  financeAccountRepository, financeBudgetRepository, financeCategoryRepository, financeGoalRepository,
  financeLiquidityRepository, financePlanningRepository, financeRecurringOccurrenceRepository, financeRecurringRepository, financeTransactionRepository,
} from '../repositories/financeRepositories'
import {
  accountBalance, annualFinanceTotals, budgetPerformance, calculateFinanceMetrics, canRegisterEventualIncome, canonicalFinanceBudgetGroups, eventualIncomeTransactions, financeBudgetReservations, financePeriodFlow, financeProjectionBreakdown, financeSummary, personalBudgetCarryOverIntoPeriod, personalBudgetForDate,
  financeGoalProjections, formatFinanceDate, formatMxn, goalAvailableCents, goalProgress, goalSpentCents, goalTargetCents, monthKey, recurringAppliesToMonth, recurringExpectedDate, savingsFundMetrics,
} from '../services/financeService'
import { budgetNameForCategory, fortnightPeriodForMonth } from '../services/financeBudgetCycle'
import { FINANCE_LIQUIDITY_PROJECTION_VERSION, financeLiquidityProjection } from '../services/financeLiquidityProjection'

type Panel = 'overview' | 'advisor' | 'transactions' | 'income' | 'accounts' | 'budgets' | 'recurring' | 'savings' | 'fund' | 'goals' | 'plan'
type Dialog = 'movementMenu' | 'transaction' | 'account' | 'budget' | 'budgetClose' | 'recurring' | 'goal' | 'goalDetail' | 'contribution' | 'fundEntry' | 'goalItem' | 'purchaseItem' | 'categories' | 'editContribution' | null
interface MovementPreset { type?: FinanceTransactionType; categoryName?: string; status?: FinanceTransactionStatus; contribution?: boolean }
const typeLabel: Record<FinanceTransactionType, string> = {
  income: 'Ingreso', expense: 'Gasto', transfer: 'Transferencia', saving: 'Ahorro',
  debt_payment: 'Pago de deuda', refund: 'Reembolso',
}
const statusLabel: Record<FinanceTransactionStatus, string> = {
  planned: 'Planeado', pending: 'Pendiente', completed: 'Completado', cancelled: 'Cancelado',
}
const mobileFinanceSections = [
  { id: 'accounts', label: 'Cuentas', description: 'Saldos y cuentas en un solo lugar', icon: WalletCards },
  { id: 'savings', label: 'Ahorro', description: 'Tu avance y acumulados del año', icon: PiggyBank },
  { id: 'goals', label: 'Metas', description: 'Ahorra para lo que viene', icon: Target },
  { id: 'fund', label: 'Fondo', description: 'Tu reserva para imprevistos', icon: Landmark },
] as const

const categoryTypeForTransaction = (type: FinanceTransactionType): FinanceCategoryType | undefined => {
  if (type === 'income' || type === 'refund') return 'income'
  if (type === 'saving') return 'saving'
  if (type === 'debt_payment') return 'debt'
  if (type === 'expense') return 'expense'
  return undefined
}
const categoryTypeLabel: Record<FinanceCategoryType, string> = {
  income: 'ingresos', expense: 'gastos', saving: 'ahorro', debt: 'pagos de deuda', transfer: 'transferencias',
}

export function FinancePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { data, loading, error, refresh, user } = useFinance()
  const [month, setMonth] = useState(() => new Date())
  const [panel, setPanel] = useState<Panel>(() => {
    const stored = sessionStorage.getItem('faro-finance-panel')
    return ['overview', 'advisor', 'transactions', 'income', 'recurring', 'savings', 'fund', 'budgets', 'goals', 'accounts', 'plan'].includes(stored ?? '')
      ? stored as Panel : 'overview'
  })
  const [dialog, setDialog] = useState<Dialog>(null)
  const [isFinanceMobile, setIsFinanceMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const update = () => setIsFinanceMobile(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const [showOverviewDetails, setShowOverviewDetails] = useState(false)
  const quickAction = new URLSearchParams(location.search).get('quick')
  const quickMovementPending = quickAction === 'movement'
  const quickExpensePending = quickAction === 'expense'
  const consumedQuickLocation = useRef<string | null>(null)
  const [movementPreset, setMovementPreset] = useState<MovementPreset>()
  const [editingTransaction, setEditingTransaction] = useState<FinanceTransaction>()
  const [editingAccount, setEditingAccount] = useState<FinanceAccount>()
  const [editingRecurring, setEditingRecurring] = useState<FinanceRecurringTransaction>()
  const [editingOccurrence, setEditingOccurrence] = useState<FinanceRecurringOccurrence>()
  const [recurringEditMode, setRecurringEditMode] = useState<'period' | 'template'>('period')
  const [editingGoal, setEditingGoal] = useState<FinanceGoal>()
  const [budgetHalfToEdit, setBudgetHalfToEdit] = useState<'q1' | 'q2'>()
  const [budgetCategoryToEdit, setBudgetCategoryToEdit] = useState<string>()
  const [editingFundEntry, setEditingFundEntry] = useState<FinanceSavingsFundEntry>()
  const [deletingFundEntry, setDeletingFundEntry] = useState<FinanceSavingsFundEntry>()
  const [editingContribution, setEditingContribution] = useState<FinanceGoalContribution>()
  const [deletingContribution, setDeletingContribution] = useState<FinanceGoalContribution>()
  const [deletingBudget, setDeletingBudget] = useState<FinanceBudget>()
  const [selectedGoal, setSelectedGoal] = useState<FinanceGoal>()
  const [selectedGoalItem, setSelectedGoalItem] = useState<FinanceGoalItem>()
  const [deletingGoalItem, setDeletingGoalItem] = useState<FinanceGoalItem>()
  const [deletingGoal, setDeletingGoal] = useState<FinanceGoal>()
  const [closingBudget,setClosingBudget]=useState<FinanceBudget>()
  const [dismissedBudgetIds,setDismissedBudgetIds]=useState<string[]>([])
  const [deleting, setDeleting] = useState<FinanceTransaction>()
  const [deletingAccount, setDeletingAccount] = useState<FinanceAccount>()
  const [deletingRecurring, setDeletingRecurring] = useState<FinanceRecurringTransaction>()
  const [revertingOccurrence, setRevertingOccurrence] = useState<FinanceRecurringOccurrence>()
  const paymentLocks = useRef(new Set<string>())
  const promptedFortnights = useRef(new Set<string>())
  const [savingPaymentId, setSavingPaymentId] = useState<string>()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [accountFilter, setAccountFilter] = useState('all')
  const [feedback, setFeedback] = useState('')
  const [sharedReceipt, setSharedReceipt] = useState<File>()
  const [sharePending, setSharePending] = useState(() => new URLSearchParams(window.location.search).has('sharedReceipt'))
  const receiptInputRef = useRef<HTMLInputElement>(null)
  const financeContentRef = useRef<HTMLDivElement>(null)
  const scrollPeriod = monthKey(month)
  useLayoutEffect(() => {
    if (!financeContentRef.current) return
    financeContentRef.current.scrollTop = 0
    financeContentRef.current.scrollLeft = 0
    for (const list of financeContentRef.current.querySelectorAll<HTMLElement>('.finance-expense-list')) {
      list.scrollTop = 0
    }
    // Narrow and short windows consolidate scrolling into an enclosing pane.
    for (const selector of ['.finance-layout', '.main-content']) {
      const pane = financeContentRef.current.closest<HTMLElement>(selector)
      if (pane) {
        pane.scrollTop = 0
        pane.scrollLeft = 0
      }
    }
  }, [panel, scrollPeriod])
  const activeAccounts = data.accounts.filter((item) => item.isActive)

  useEffect(() => {
    if ((!quickMovementPending && !quickExpensePending) || loading) return
    const entry = `${location.key}:${location.search}`
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled || consumedQuickLocation.current === entry) return
      consumedQuickLocation.current = entry
      if (!activeAccounts.length) {
        setFeedback(quickExpensePending ? 'Crea una cuenta antes de registrar tu primer gasto.' : 'Crea una cuenta antes de registrar tu primer movimiento.')
      } else if (quickExpensePending) {
        setMovementPreset({ type: 'expense', status: 'completed' })
        setDialog('transaction')
      } else setDialog('movementMenu')
      const search = new URLSearchParams(location.search)
      search.delete('quick')
      navigate({ pathname: location.pathname, search: search.toString() ? `?${search}` : '', hash: location.hash }, { replace: true, state: location.state })
    })
    return () => { cancelled = true }
  }, [activeAccounts.length, loading, location, navigate, quickExpensePending, quickMovementPending])

  useEffect(() => {
    const url = new URL(window.location.href)
    const token = url.searchParams.get('sharedReceipt')
    const receiptError = url.searchParams.get('receiptError')
    if (!token && !receiptError) return
    url.searchParams.delete('sharedReceipt')
    url.searchParams.delete('receiptError')
    window.history.replaceState(window.history.state, '', url)
    if (receiptError) {
      queueMicrotask(() => setFeedback('El archivo compartido no es una imagen compatible o no pudo abrirse.'))
      return
    }
    void (async () => {
      try {
        const cache = await caches.open('faro-shared-receipts-v1')
        const key = new URL(`${import.meta.env.BASE_URL}__receipt/${token}`, window.location.origin)
        const response = await cache.match(key.href)
        if (!response) throw new Error('No encontré el comprobante compartido. Intenta compartirlo de nuevo.')
        const blob = await response.blob()
        const name = decodeURIComponent(response.headers.get('X-Faro-File-Name') || 'comprobante.png')
        await cache.delete(key.href)
        setSharedReceipt(new File([blob], name, { type: blob.type || 'image/png' }))
      } catch (reason) {
        setFeedback(reason instanceof Error ? reason.message : 'No pude abrir el comprobante.')
      } finally { setSharePending(false) }
    })()
  }, [])

  useEffect(() => {
    if (!feedback) return
    const timeout = window.setTimeout(() => setFeedback(''), 3000)
    return () => window.clearTimeout(timeout)
  }, [feedback])
  useEffect(()=>{if(loading||dialog||sharedReceipt||sharePending||quickExpensePending||quickMovementPending)return;const candidate=data.budgets.find(item=>(item.periodEnd??item.month)<format(new Date(),'yyyy-MM-dd')&&!dismissedBudgetIds.includes(item.id)&&!data.budgetClosures.some(closure=>closure.budgetId===item.id));if(candidate)queueMicrotask(()=>{setClosingBudget(candidate);setDialog('budgetClose')})},[data.budgetClosures,data.budgets,dialog,dismissedBudgetIds,loading,quickExpensePending,quickMovementPending,sharedReceipt,sharePending])
  useEffect(() => {
    if (loading || dialog || sharedReceipt || sharePending || quickExpensePending || quickMovementPending || !user || monthKey(month) !== monthKey(new Date())) return
    const today = format(new Date(), 'yyyy-MM-dd')
    const half = today.slice(-2) <= '15' ? 'q1' : 'q2'
    const period = fortnightPeriodForMonth(monthKey(month), half)
    const promptKey = `${user.id}:${period.periodStart}`
    const hasPersonalCategory = data.categories.some((category) => category.isActive
      && category.type === 'expense'
      && category.name.trim().toLocaleLowerCase('es-MX') === 'personal')
    if (!hasPersonalCategory || personalBudgetForDate(data.budgets, period.periodStart) || promptedFortnights.current.has(promptKey)) return
    promptedFortnights.current.add(promptKey)
    queueMicrotask(() => {
      setBudgetHalfToEdit(half)
      setDialog('budget')
    })
  }, [data.budgets, data.categories, dialog, loading, month, quickExpensePending, quickMovementPending, sharedReceipt, sharePending, user])

  const metrics = useMemo(() => calculateFinanceMetrics(data, month), [data, month])
  const projectionBreakdown = useMemo(() => financeProjectionBreakdown(data, month), [data, month])
  const baselineBudgetCategoryIds = useMemo(() => [...new Set(canonicalFinanceBudgetGroups(data)
    .filter((group) => !group.isPersonal)
    .map((group) => group.budget.categoryId))], [data])
  const baselineLiquidityProjection = useMemo(() => financeLiquidityProjection({
    data,
    month,
    currentAvailableBalanceCents: metrics.availableBalanceCents,
    minimumOperatingBufferCents: data.liquidityPreference.minimumOperatingBufferCents,
    includePersonalBudgetReservations: true,
    includedBudgetCategoryIds: baselineBudgetCategoryIds,
  }), [baselineBudgetCategoryIds, data, metrics.availableBalanceCents, month])
  const midMonthProjection = useMemo(() => {
    const midpointDate = format(new Date(month.getFullYear(), month.getMonth(), 15), 'yyyy-MM-dd')
    const datedBalanceCents = baselineLiquidityProjection.days.find((day) => day.date === midpointDate)?.balanceCents
      ?? baselineLiquidityProjection.closingBalanceCents
    return {
      date: midpointDate,
      balanceCents: datedBalanceCents,
    }
  }, [baselineLiquidityProjection.closingBalanceCents, baselineLiquidityProjection.days, month])
  const liquiditySnapshot = data.liquiditySnapshots.find((snapshot) =>
    snapshot.month === monthKey(month) && snapshot.projectionVersion === FINANCE_LIQUIDITY_PROJECTION_VERSION)
  const liquiditySnapshotRequests = useRef(new Set<string>())
  useEffect(() => {
    if (!user || loading || liquiditySnapshot) return
    const key = monthKey(month)
    if (liquiditySnapshotRequests.current.has(key)) return
    liquiditySnapshotRequests.current.add(key)
    void financeLiquidityRepository.captureInitialSnapshot({
      month: key,
      projectionVersion: FINANCE_LIQUIDITY_PROJECTION_VERSION,
      projectedMinimumCents: baselineLiquidityProjection.minimumBalanceCents,
      projectedClosingBalanceCents: baselineLiquidityProjection.closingBalanceCents,
    }, user.id).then(() => refresh()).catch((reason: unknown) => {
      liquiditySnapshotRequests.current.delete(key)
      if (import.meta.env.DEV) console.debug('[FARO finance] No se pudo capturar snapshot de liquidez.', reason)
    })
  }, [baselineLiquidityProjection.closingBalanceCents, baselineLiquidityProjection.minimumBalanceCents, liquiditySnapshot, loading, month, refresh, user])
  useEffect(() => {
    if (!import.meta.env.DEV) return
    console.debug('[FARO finance] Liquidity projection computed.', {
      projection_compute_ms: Math.round(baselineLiquidityProjection.computeMs * 100) / 100,
      number_of_movements: baselineLiquidityProjection.events.length,
      period: baselineLiquidityProjection.periodStart,
      status: baselineLiquidityProjection.status,
    })
  }, [baselineLiquidityProjection.computeMs, baselineLiquidityProjection.events.length, baselineLiquidityProjection.periodStart, baselineLiquidityProjection.status])
  const periodFlow = useMemo(() => financePeriodFlow(data, month), [data, month])
  const approvedPeriodFlow = useMemo(() => ({
    incomeCents: periodFlow.incomeCents,
    expenseCents: periodFlow.expenseCents,
    netCents: periodFlow.incomeCents - periodFlow.expenseCents,
  }), [periodFlow])
  const approvedAvailableEvolution = useMemo(() => ({
    initialCents: metrics.availableBalanceCents - approvedPeriodFlow.incomeCents + approvedPeriodFlow.expenseCents,
    ...approvedPeriodFlow,
    finalCents: metrics.availableBalanceCents,
  }), [approvedPeriodFlow, metrics.availableBalanceCents])
  const annualTotals = useMemo(() => annualFinanceTotals(data, month.getFullYear()), [data, month])
  const previous = useMemo(() => calculateFinanceMetrics(data, subMonths(month, 1)), [data, month])
  const summary = useMemo(() => financeSummary(data, month), [data, month])
  const budgets = useMemo(() => budgetPerformance(data, month), [data, month])
  const fundMetrics = useMemo(() => savingsFundMetrics(data, month), [data, month])
  const previousMonthKey = format(subMonths(month, 1), 'yyyy-MM')
  const hasPreviousData = data.transactions.some((item) => item.transactionDate.startsWith(previousMonthKey))
  const monthlyTransactions = data.transactions.filter((item) => item.transactionDate.startsWith(format(month, 'yyyy-MM')))
  const eventualIncomes = eventualIncomeTransactions(monthlyTransactions)
  const selectedPeriod = monthKey(month)
  const recurringForMonth = data.recurring
    .filter((item) => recurringAppliesToMonth(item, month))
    .flatMap<{ item: FinanceRecurringTransaction; occurrence?: FinanceRecurringOccurrence; expectedDate?: string }>((item) => {
      const occurrences = data.recurringOccurrences.filter((candidate) =>
        candidate.recurringTransactionId === item.id && candidate.period === selectedPeriod)
      return occurrences.length
        ? occurrences.map((occurrence) => ({ item, occurrence, expectedDate: occurrence.expectedDate }))
        : [{ item, occurrence: undefined, expectedDate: undefined }]
    })
    .sort((left, right) => {
      const rank = (status?: string) => status === 'paid' || status === 'skipped' ? 1 : 0
      return rank(left.occurrence?.status) - rank(right.occurrence?.status)
        || (left.expectedDate ?? '9999-12-31').localeCompare(right.expectedDate ?? '9999-12-31')
    })
  const projectionFor = (kind: 'income' | 'expense') => {
    const matches = (type: FinanceTransaction['type']) => kind === 'income'
      ? type === 'income' || type === 'refund'
      : type === 'expense' || type === 'debt_payment'
    const pendingRecurring = data.recurring.filter((item) => item.isActive && matches(item.type) && recurringAppliesToMonth(item, month)).flatMap((item) => {
      return data.recurringOccurrences.filter((occurrence) => {
        if (occurrence.recurringTransactionId !== item.id || occurrence.period !== selectedPeriod || !occurrence.amountCents) return false
        const generatedMovementExists = Boolean(occurrence.transactionId && data.transactions.some((transaction) =>
          transaction.id === occurrence.transactionId && transaction.status === 'completed'))
        return occurrence.expectedDate.startsWith(format(month, 'yyyy-MM'))
          && occurrence.status !== 'skipped' && !(occurrence.status === 'paid' && generatedMovementExists)
      })
    })
    const recurringCents = monthlyTransactions
      .filter((item) => Boolean(item.recurringTransactionId) && matches(item.type) && item.status === 'completed')
      .reduce((sum, item) => sum + item.amountCents, 0)
      + pendingRecurring.reduce((sum, occurrence) => sum + (occurrence.amountCents ?? 0), 0)
    const eventualCents = monthlyTransactions
      .filter((item) => !item.recurringTransactionId && matches(item.type) && item.status !== 'cancelled')
      .reduce((sum, item) => sum + item.amountCents, 0)
    const realizedCents = monthlyTransactions
      .filter((item) => matches(item.type) && item.status === 'completed')
      .reduce((sum, item) => sum + item.amountCents, 0)
    const pendingCents = kind === 'income' ? projectionBreakdown.ingresosPendientes : projectionBreakdown.gastosPendientes
    const budgetReservationCents = kind === 'expense'
      ? financeBudgetReservations(data, month).reduce((sum, reservation) => sum + reservation.amountCents, 0)
      : 0
    const pendingCount = pendingRecurring.length + monthlyTransactions.filter((item) => !item.recurringTransactionId && matches(item.type) && ['planned', 'pending'].includes(item.status)).length
    return { recurringCents, eventualCents, totalCents: realizedCents + pendingCents, realizedCents, pendingCents, pendingCount, budgetReservationCents }
  }
  const incomeProjection = projectionFor('income')
  const expenseProjection = projectionFor('expense')
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
  const reportExpenses = monthlyTransactions
    .filter((item) => item.status === 'completed' && (item.type === 'expense' || item.type === 'debt_payment'))
    .map((item) => ({
      date: item.transactionDate,
      amountCents: item.amountCents,
      description: item.description,
      category: data.categories.find((category) => category.id === item.categoryId)?.name,
    }))
  const exportMonthlyReport = async () => {
    setFeedback('Generando reporte financiero…')
    try {
      const { downloadFinanceReportPdf } = await import('../services/financeReportPdf')
      downloadFinanceReportPdf({
        month,
        metrics,
        summary,
        categories: categoryExpenses,
        incomeCents: metrics.monthlyIncomeCents,
        expenseCents: metrics.monthlyExpensesCents,
        pendingExpenseCents: expenseProjection.pendingCents,
        completedExpenses: reportExpenses,
      })
      setFeedback('Reporte financiero descargado en PDF.')
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'No se pudo generar el reporte PDF.')
    }
  }
  const finish = async (message: string) => {
    setDialog(null); setEditingTransaction(undefined); setEditingAccount(undefined)
    setEditingRecurring(undefined); setEditingOccurrence(undefined); setEditingGoal(undefined); setSelectedGoal(undefined)
    setEditingFundEntry(undefined); setEditingContribution(undefined)
    await refresh()
    window.dispatchEvent(new Event('faro:finance-updated'))
    setFeedback(message)
  }
  const status = async (transaction: FinanceTransaction, next: FinanceTransactionStatus) => {
    if (!user) return
    try {
      await financeTransactionRepository.setStatus(transaction.id, next, user.id)
      await finish('Movimiento actualizado.')
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'No se pudo actualizar el movimiento.')
    }
  }
  const changePanel = (next: Panel) => {
    setPanel(next)
    setMobileFiltersOpen(false)
    sessionStorage.setItem('faro-finance-panel', next)
    if (isFinanceMobile) window.scrollTo({ top: 0, behavior: 'auto' })
  }
  const startMovement = (preset: MovementPreset) => {
    if (preset.contribution) {
      setSelectedGoal(undefined)
      setDialog('contribution')
      return
    }
    setMovementPreset(preset)
    setDialog('transaction')
  }
  const registerRecurringPayment = async (item: FinanceRecurringTransaction, currentOccurrence?: FinanceRecurringOccurrence) => {
    const lockId = currentOccurrence?.id ?? item.id
    if (!user || paymentLocks.current.has(lockId)) return
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
    paymentLocks.current.add(lockId); setSavingPaymentId(lockId)
    try {
      await financeRecurringOccurrenceRepository.register(item.id, selectedPeriod, expectedDate, user.id)
      await finish(item.type === 'income' ? 'Cobro registrado.' : 'Pago registrado.')
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'No se pudo registrar la ocurrencia.')
    } finally {
      paymentLocks.current.delete(lockId); setSavingPaymentId(undefined)
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
  const setRecurringMonthStatus = async (item: FinanceRecurringTransaction, currentOccurrence: FinanceRecurringOccurrence | undefined, next: 'skipped' | 'postponed') => {
    const lockId = currentOccurrence?.id ?? item.id
    if (!user || paymentLocks.current.has(lockId)) return
    paymentLocks.current.add(lockId); setSavingPaymentId(lockId)
    try {
      const expectedDate = recurringExpectedDate(item, month)
      const occurrence = currentOccurrence
        ?? await financeRecurringOccurrenceRepository.ensure(item.id, selectedPeriod, expectedDate, user.id)
      await financeRecurringOccurrenceRepository.setStatus(occurrence.id, next, user.id)
      await finish(next === 'skipped' ? 'Periodo saltado.' : 'Pago pospuesto.')
    } finally {
      paymentLocks.current.delete(lockId); setSavingPaymentId(undefined)
    }
  }
  const registerEventualPayment = async (item: FinanceTransaction) => {
    if (!canRegisterEventualIncome(item) || paymentLocks.current.has(item.id)) return
    paymentLocks.current.add(item.id); setSavingPaymentId(item.id)
    try { await status(item, 'completed') }
    finally { paymentLocks.current.delete(item.id); setSavingPaymentId(undefined) }
  }

  if (loading && !data.categories.length) return <div className="page"><div className="planning-skeleton">Sincronizando finanzas…</div></div>
  if (error && !data.categories.length) return <div className="page"><EmptyState title="No pudimos cargar Finanzas" description={error} action={<Button onClick={refresh}>Reintentar</Button>} /></div>

  return <div className={`page finance-os finance-os--${panel}`} aria-busy={loading}>
    <div className="finance-mobile-heading">
      <span>FARO · Finanzas</span>
      <h1>{panel === 'overview' ? 'Tu resumen' : panel === 'transactions' ? 'Movimientos' : panel === 'advisor' ? 'Proyecciones' : panel === 'plan' ? 'Tu plan' : ({ income: 'Ingresos', recurring: 'Gastos', savings: 'Ahorro', budgets: 'Presupuesto', goals: 'Metas', accounts: 'Cuentas', fund: 'Fondo' } as const)[panel]}</h1>
    </div>
    <nav className="finance-mobile-tabs" aria-label="Navegación de finanzas">
      {([{ id: 'overview', label: 'Resumen' }, { id: 'advisor', label: 'Proyecciones' }, { id: 'income', label: 'Ingresos' }, { id: 'recurring', label: 'Gastos' }, { id: 'plan', label: 'Plan' }, { id: 'transactions', label: 'Movimientos' }, { id: 'budgets', label: 'Presupuestos' }] as const).map(({ id, label }) => <button key={id} type="button" aria-current={panel === id ? 'page' : undefined} onClick={() => changePanel(id)}>{label}</button>)}
      <button type="button" aria-haspopup="dialog" aria-expanded={mobileMoreOpen} aria-label="Más secciones de Finanzas" className={['savings', 'goals', 'accounts', 'fund'].includes(panel) ? 'is-active' : ''} onClick={() => setMobileMoreOpen(true)}><Ellipsis size={18} aria-hidden="true" /><span>Más</span></button>
    </nav>
    <PageHeader
      eyebrow={format(new Date(), "EEEE, d 'de' MMMM", { locale: es })}
      title="Finanzas"
      trailing={panel === 'plan' ? <div className="finance-period finance-period--page-toolbar"><span className="finance-plan-current-date"><CalendarDays size={16} />{format(new Date(), 'd MMM yyyy', { locale: es })}</span><button aria-label="Actualizar datos financieros" title="Actualizar" onClick={() => void refresh()}><RefreshCw size={14} /></button></div> : <div className="finance-period finance-period--page-toolbar"><button aria-label="Mes anterior" onClick={() => setMonth((value) => subMonths(value, 1))}><ArrowLeft size={15} /></button><label><CalendarDays size={16} /><span>{format(month, "MMMM 'de' yyyy", { locale: es })}</span><input aria-label="Periodo" type="month" value={format(month, 'yyyy-MM')} onChange={(event) => event.target.value && setMonth(parseISO(`${event.target.value}-01`))} /></label><button aria-label="Mes siguiente" onClick={() => setMonth((value) => addMonths(value, 1))}><ArrowRight size={15} /></button><button aria-label="Actualizar datos financieros" title="Actualizar" onClick={() => void refresh()}><RefreshCw size={14} /></button><button aria-label="Descargar reporte financiero en PDF" title="Descargar reporte PDF" onClick={exportMonthlyReport}><FileDown size={14} /></button></div>}
    />
    {(error || loading) && <div className={`finance-data-status${error ? ' finance-data-status--error' : ''}`} role={error ? 'alert' : 'status'}>
      <div><strong>{error ? 'No pudimos actualizar tus finanzas' : 'Actualizando tus finanzas'}</strong><p>{error ? `${error} Estás viendo los últimos datos cargados.` : 'Conservamos tus datos mientras termina la actualización.'}</p></div>
      {error && <Button variant="secondary" onClick={() => void refresh()}>Reintentar</Button>}
    </div>}
    {feedback && <div className="finance-feedback" role="status">{feedback}<button aria-label="Cerrar aviso" onClick={() => setFeedback('')}>×</button></div>}
    {!data.accounts.length && <section className="finance-onboarding"><WalletCards /><div><strong>Crea tu primera cuenta</strong><p>El saldo inicial será la base de tus cálculos. Después podrás registrar tu primer ingreso sin ingresar datos bancarios sensibles.</p></div><Button onClick={() => setDialog('account')}>Crear cuenta</Button><Button variant="ghost" disabled title="Crea una cuenta antes de registrar el ingreso">Registrar ingreso</Button></section>}
    <div className="finance-tabs-row">
      <FinanceNavigation value={panel} onChange={changePanel} onManageCategories={() => setDialog('categories')} />
      <Button className="finance-new-movement" icon={<Plus size={17} />} disabled={!activeAccounts.length} onClick={() => setDialog('movementMenu')}>Nuevo movimiento</Button>
    </div>
    {(panel === 'overview' || panel === 'transactions') && <section className="finance-mobile-balance" aria-label="Resumen de saldo">
      <span>Disponible operativo hoy</span>
      <div className="finance-mobile-balance__amount"><strong>{formatMxn(metrics.availableBalanceCents)}</strong><small>MXN</small></div>
      <div className="finance-mobile-balance__detail">
        <div><span>Ingresos del mes</span><strong>{formatMxn(metrics.monthlyIncomeCents)}</strong></div>
        <div><span>{panel === 'transactions' ? 'Gastos del mes' : 'Gastos pendientes'}</span><strong>{formatMxn(panel === 'transactions' ? metrics.monthlyExpensesCents : projectionBreakdown.gastosPendientes)}</strong></div>
      </div>
    </section>}
    {(panel === 'overview' || panel === 'transactions') && <div className="finance-mobile-actions">
      <Button icon={<Plus size={20} />} disabled={!activeAccounts.length} onClick={() => setDialog('movementMenu')}>Registrar movimiento</Button>
      {panel === 'overview' && <Button variant="ghost" icon={<CalendarDays size={19} />} onClick={() => startMovement({ type: 'expense', status: 'planned' })} disabled={!activeAccounts.length}>Planificar gasto</Button>}
    </div>}
    <Modal open={mobileMoreOpen} title="Tus herramientas de Finanzas" panelClassName="finance-dialog finance-mobile-more-modal" onClose={() => setMobileMoreOpen(false)}>
      <p className="finance-mobile-more-intro">Todo lo que necesitas para organizar tu dinero.</p>
      <nav className="finance-mobile-more" aria-label="Herramientas de Finanzas">
        {mobileFinanceSections.map(({ id, label, description, icon: Icon }) => <button key={id} type="button" aria-current={panel === id ? 'page' : undefined} onClick={() => { changePanel(id); setMobileMoreOpen(false) }}><i aria-hidden="true"><Icon size={21} /></i><span><strong>{label}</strong><small>{description}</small></span><ArrowRight size={17} /></button>)}
      </nav>
      <div className="finance-mobile-more-utilities"><button type="button" onClick={() => { setMobileMoreOpen(false); setDialog('categories') }}>Gestionar categorías</button>
        <button type="button" onClick={() => { setMobileMoreOpen(false); void refresh() }}><RefreshCw size={17} />Actualizar datos</button>
        <button type="button" onClick={() => { setMobileMoreOpen(false); void exportMonthlyReport() }}><FileDown size={17} />Reporte PDF</button>
        <Link to="/dashboard"><House size={17} />Inicio de FARO<ArrowRight size={16} /></Link>
      </div>
    </Modal>
    <div className="finance-layout">
    <div ref={financeContentRef} className="finance-content" role="region" aria-label="Contenido de Finanzas" tabIndex={0}>

    {panel === 'plan' && user && <DebtPlanPanel data={data} userId={user.id} onRefresh={refresh} onEditMovement={item => { setEditingTransaction(item); setDialog('transaction') }} onDeleteMovement={item => setDeleting(item)} />}

    {panel === 'overview' && <>
      <div className="finance-mobile-chart finance-overview-chart"><FinanceLiquidityRadar summary data={data} month={month} availableTodayCents={metrics.availableBalanceCents} snapshot={liquiditySnapshot} userId={user?.id} onSaveMinimumBuffer={async () => {}} /></div>
      <button className="finance-mobile-details-toggle" type="button" aria-expanded={showOverviewDetails} aria-controls="finance-overview-details" onClick={() => setShowOverviewDetails((value) => !value)}>{showOverviewDetails ? 'Ocultar detalles del resumen' : 'Ver más del resumen'}<ArrowDownRight size={17} /></button>
      <div id="finance-overview-details" className={`finance-overview-details${showOverviewDetails ? ' is-expanded' : ''}`}>
      <ProjectionStrip
        compact
        items={[
          { icon: <WalletCards />, label: 'Ingresos proyectados', value: incomeProjection.totalCents, tone: 'positive' },
          { icon: <Calculator />, label: 'Gastos proyectados', value: expenseProjection.totalCents, tone: 'negative' },
          { icon: <ChartNoAxesCombined />, label: 'Flujo neto proyectado', value: incomeProjection.totalCents - expenseProjection.totalCents, tone: incomeProjection.totalCents >= expenseProjection.totalCents ? 'positive' : 'negative' },
          { icon: <PiggyBank />, label: 'Tasa de ahorro realizada', text: `${metrics.savingsRate.toFixed(1)}%`, context: 'sobre ingresos cobrados', tone: 'savings' },
        ]}
      />
      <div className="finance-summary-grid">
      <section className="finance-excel">
        <header><span className="eyebrow">Previsión mensual</span><h2>Planeado contra real</h2></header>
        <div className="finance-table finance-table--summary finance-scroll-region" tabIndex={0} role="region" aria-label="Comparativo mensual: planeado contra real"><div className="finance-table__head"><span>Concepto</span><span>Planeado</span><span>Real</span><span>Diferencia</span></div>
          {summary.map((row) => <div className="finance-table__row" key={row.label}><strong>{row.label}</strong><span data-label="Planeado">{formatMxn(row.planned)}</span><span data-label="Real">{formatMxn(row.actual)}</span><span data-label="Diferencia" className={row.difference >= 0 ? 'positive' : 'negative'}>{formatMxn(row.difference)}</span></div>)}
        </div>
      </section>
        <section className="finance-period-flow"><header><span className="eyebrow">{format(month, 'MMMM yyyy', { locale: es })}</span><h2>Flujo del periodo</h2></header><PeriodFlowChart flow={approvedPeriodFlow} /></section>
        <section><header><span className="eyebrow">Distribución</span><h2>Gasto por categoría</h2></header><ExpenseCategoryDonut data={categoryExpenses} /></section>
        <section className="finance-available-evolution"><header><span className="eyebrow">Disponible operativo</span><h2>Evolución del disponible</h2></header><div className="finance-waterfall"><span><small>Inicial</small><strong>{formatMxn(approvedAvailableEvolution.initialCents)}</strong></span><i>+</i><span className="positive"><small>Ingresos</small><strong>{formatMxn(approvedAvailableEvolution.incomeCents)}</strong></span><i>−</i><span className="negative"><small>Gastos</small><strong>{formatMxn(approvedAvailableEvolution.expenseCents)}</strong></span><i>=</i><span className="final"><small>Final</small><strong>{formatMxn(approvedAvailableEvolution.finalCents)}</strong></span></div><p>Las transferencias sólo redistribuyen dinero entre cuentas y no alteran este resultado.</p></section>
      </div>
      </div>
    </>}

    {panel === 'advisor' && <FinanceLiquidityRadar
      data={data}
      month={month}
      availableTodayCents={metrics.availableBalanceCents}
      snapshot={liquiditySnapshot}
      userId={user?.id}
      onSaveMinimumBuffer={async (minimumOperatingBufferCents) => {
        if (!user) throw new Error('No hay una sesión activa.')
        await financeLiquidityRepository.saveMinimumOperatingBuffer(minimumOperatingBufferCents, user.id)
        await refresh()
      }}
    />}

    {panel === 'transactions' && <section className="finance-section">
      <div className="finance-mobile-movement-filters" role="group" aria-label="Filtrar movimientos por tipo">{([['all', 'Todos'], ['income', 'Ingresos'], ['expense', 'Gastos']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={typeFilter === value} onClick={() => setTypeFilter(value)}>{label}</button>)}</div>
      <button type="button" className="finance-mobile-filter-toggle" aria-expanded={mobileFiltersOpen} aria-controls="finance-movement-filters" onClick={() => setMobileFiltersOpen((value) => !value)}><Search size={16} />{mobileFiltersOpen ? 'Ocultar filtros' : 'Buscar y filtrar'}</button>
      <div id="finance-movement-filters" className={`finance-toolbar${mobileFiltersOpen ? ' is-expanded' : ''}`}><input aria-label="Buscar movimientos" placeholder="Buscar…" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="Cuenta" value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}><option value="all">Todas las cuentas</option>{data.accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="Tipo" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">Todos los tipos</option>{Object.entries(typeLabel).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><select aria-label="Estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos los estados</option>{Object.entries(statusLabel).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
      <div className="finance-table finance-table--transactions finance-scroll-region" tabIndex={0} role="region" aria-label="Movimientos financieros"><div className="finance-table__head"><span>Fecha</span><span>Descripción</span><span>Categoría / cuenta</span><span>Estado</span><span>Monto</span><span>Acciones</span></div>
        {filteredTransactions.map((item, index) => <Fragment key={item.id}>
          {(index === 0 || filteredTransactions[index - 1]?.transactionDate !== item.transactionDate)
            && <div className="finance-date-group">{movementDateLabel(item.transactionDate)}</div>}
          <div className="finance-table__row">
            <time>{format(parseISO(item.transactionDate), 'dd MMM')}</time>
            <strong>{item.description}<small>{typeLabel[item.type]}{item.debtId && ` · ${data.debtPlan?.debts.find(debt => debt.id === item.debtId)?.name ?? 'Deuda vinculada'}`}</small></strong>
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
            ? <><Button variant="ghost" onClick={async () => { if (!user) return; await financeAccountRepository.archive(account.id, user.id); await finish('Cuenta archivada.') }}>Archivar</Button><Button variant="ghost" icon={<Trash2 size={13} />} onClick={() => setDeletingAccount(account)}>Eliminar</Button></>
            : <><Button variant="ghost" icon={<RotateCcw size={13} />} onClick={async () => { if (!user) return; await financeAccountRepository.restore(account.id, user.id); await finish('Cuenta restaurada.') }}>Restaurar</Button><Button variant="ghost" icon={<Trash2 size={13} />} onClick={() => setDeletingAccount(account)}>Eliminar definitivamente</Button></>}
        </nav>
      </article>)}</div>
      {!data.accounts.length && <EmptyState title="Tus cuentas, en orden" description="Añade una cuenta para registrar movimientos y conocer tu saldo." action={<Button onClick={() => setDialog('account')}>Crear cuenta</Button>} />}
    </section>}

    {panel === 'budgets' && <section className="finance-section finance-budgets"><SectionHead eyebrow="Control quincenal" title="Presupuestos por categoría" action="Definir presupuesto" onClick={() => { setBudgetHalfToEdit(undefined); setBudgetCategoryToEdit(undefined); setDialog('budget') }} />{budgets.length ? <div className="finance-budget-list">{budgets.map((budget) => { const half = budget.periodStart?.slice(-2) === '01' ? 'q1' : 'q2'; return <article key={budget.id} className={budget.usedPercentage > 100 ? 'exceeded' : budget.usedPercentage >= 85 ? 'warning' : budget.usedPercentage >= 70 ? 'attention' : ''}><div><div><small>{half === 'q1' ? 'Q1 · 1 al 15' : 'Q2 · 16 al cierre'}</small><strong>{budget.name ?? budget.category?.name ?? 'Presupuesto'}</strong></div><span>{budget.periodStart} — {budget.periodEnd}</span></div>{budget.previousPeriodAdjustmentCents < 0 && <div className="finance-budget-adjustment"><span>Exceso de Q1 aplicado a Q2</span><strong>{formatMxn(budget.previousPeriodAdjustmentCents)}</strong><small>Tu límite disponible se ajustó a {formatMxn(budget.effectivePlannedAmountCents)}.</small></div>}<div className="finance-budget-amounts"><span>Asignado<strong>{formatMxn(budget.plannedAmountCents)}</strong></span><span>Gastado<strong>{formatMxn(budget.actualCents)}</strong></span><span>Disponible<b>{formatMxn(budget.remainingCents)}</b></span></div><ProgressBar value={Math.min(100, budget.usedPercentage)} /><footer><span>{budget.usedPercentage.toFixed(0)}% utilizado · {budget.usedPercentage > 100 ? 'Excedido' : budget.usedPercentage >= 100 ? 'Límite alcanzado' : budget.usedPercentage >= 85 ? 'Alerta 85%' : budget.usedPercentage >= 70 ? 'Atención 70%' : 'En control'}</span><div className="finance-budget-actions"><b>{Math.max(0, 100 - budget.usedPercentage).toFixed(0)}% libre</b><Button variant="ghost" size="sm" icon={<Pencil size={12} />} onClick={() => { setBudgetHalfToEdit(half); setBudgetCategoryToEdit(budget.categoryId); setDialog('budget') }}>Editar {half.toUpperCase()}</Button><Button variant="ghost" size="sm" icon={<Trash2 size={12} />} aria-label={`Eliminar presupuesto ${budget.name ?? ''}`} onClick={() => setDeletingBudget(budget)}>Eliminar</Button></div></footer></article> })}</div> : <EmptyState title="Sin presupuesto quincenal" description="Define un límite por categoría para esta quincena." action={<Button onClick={() => { setBudgetHalfToEdit(undefined); setBudgetCategoryToEdit(undefined); setDialog('budget') }}>Crear presupuesto</Button>} />}</section>}

    {panel === 'income' && <div className="finance-expenses-grid">
      <section className="finance-mobile-income" aria-label="Resumen de ingresos del periodo">
        <span>Ingresos cobrados del mes</span>
        <strong>{formatMxn(incomeProjection.realizedCents)}</strong>
        <div><span>Por cobrar<b>{formatMxn(incomeProjection.pendingCents)}</b></span><span>Total previsto<b>{formatMxn(incomeProjection.totalCents)}</b></span></div>
        <small>{incomeProjection.pendingCount ? `${incomeProjection.pendingCount} cobro${incomeProjection.pendingCount === 1 ? '' : 's'} pendiente${incomeProjection.pendingCount === 1 ? '' : 's'} este mes` : 'Estás al día con tus ingresos registrados'}</small>
        <Button icon={<Plus size={18} />} disabled={!activeAccounts.length} onClick={() => startMovement({ type: 'income', status: 'completed' })}>Registrar ingreso</Button>
      </section>
      <ProjectionStrip items={projectionItems(incomeProjection)} />
      <section className="finance-expense-panel">
        <SectionHead eyebrow="Entradas previsibles" title="Ingresos recurrentes" action="+" actionLabel="Registrar ingreso recurrente" onClick={() => { setMovementPreset({ type: 'income' }); setDialog('recurring') }} />
        <FinanceList label="Ingresos recurrentes">{recurringForMonth.filter(({ item }) => item.type === 'income').map(({ item, expectedDate, occurrence }) => <RecurringCard key={occurrence?.id ?? item.id} item={item} expectedDate={expectedDate} occurrence={occurrence} account={data.accounts.find((account) => account.id === item.accountId)?.name} category={data.categories.find((category) => category.id === item.categoryId)?.name} busy={savingPaymentId === (occurrence?.id ?? item.id)} onRegister={() => void registerRecurringPayment(item, occurrence)} onEdit={() => { setRecurringEditMode('period'); setEditingRecurring(item); setEditingOccurrence(occurrence); setDialog('recurring') }} onDelete={() => setDeletingRecurring(item)} />)}</FinanceList>
        {!recurringForMonth.some(({ item }) => item.type === 'income') && <EmptyState title="Sin ingresos recurrentes" description="Registra sueldo, honorarios o pagos periódicos esperados." />}
      </section>
      <section className="finance-expense-panel">
        <SectionHead eyebrow="Entradas extraordinarias" title="Ingresos eventuales" action="+" actionLabel="Registrar eventual" onClick={() => startMovement({ type: 'income', status: 'planned' })} />
        <FinanceList label="Ingresos eventuales">{eventualIncomes.map((item) => <EventualIncomeCard key={item.id} item={item} account={data.accounts.find((account) => account.id === item.accountId)?.name} category={data.categories.find((category) => category.id === item.categoryId)?.name} busy={savingPaymentId === item.id} onRegister={() => void registerEventualPayment(item)} onEdit={() => { setEditingTransaction(item); setDialog('transaction') }} onStatus={(next) => void status(item, next)} onDelete={() => setDeleting(item)} />)}</FinanceList>
        {!eventualIncomes.length && <EmptyState title="Sin ingresos eventuales" description="Planea bonos, ventas o pagos extraordinarios sin afectar el saldo real." />}
      </section>
    </div>}

    {panel === 'recurring' && <div className="finance-expenses-grid">
      <ProjectionStrip items={projectionItems(expenseProjection)} />
      <section className="finance-expense-panel">
        <SectionHead eyebrow="Calendario financiero" title="Gastos recurrentes" action="+" actionLabel="Registrar gasto recurrente" onClick={() => setDialog('recurring')} />
        <FinanceList label="Gastos recurrentes">{recurringForMonth.filter(({ item }) => item.type !== 'income' && item.type !== 'refund').map(({ item, expectedDate, occurrence }) => <RecurringCard key={occurrence?.id ?? item.id} item={item} expectedDate={expectedDate} occurrence={occurrence} account={data.accounts.find((account) => account.id === item.accountId)?.name} category={[data.categories.find((category) => category.id === item.categoryId)?.name, item.debtId ? `Deuda: ${data.debtPlan?.debts.find(debt => debt.id === item.debtId)?.name ?? 'vinculada'}` : undefined].filter(Boolean).join(' · ')} busy={savingPaymentId === (occurrence?.id ?? item.id)} onRegister={() => void registerRecurringPayment(item, occurrence)} onEdit={() => { setRecurringEditMode('period'); setEditingRecurring(item); setEditingOccurrence(occurrence); setDialog('recurring') }} onDelete={() => setDeletingRecurring(item)} />)}</FinanceList>
        {!recurringForMonth.some(({ item }) => item.type !== 'income' && item.type !== 'refund') && <EmptyState title="Sin gastos recurrentes" description="Registra renta, servicios o cualquier gasto periódico." />}
      </section>
      <section className="finance-expense-panel">
        <SectionHead eyebrow="Una sola ocasión" title="Gastos eventuales" action="+" actionLabel="Registrar eventual" onClick={() => startMovement({ type: 'expense', status: 'planned' })} />
        <FinanceList label="Gastos eventuales">{monthlyTransactions.filter((item) => !item.recurringTransactionId && (item.type === 'expense' || item.type === 'debt_payment')).sort((a, b) => {
          const rank = (status: FinanceTransactionStatus) => status === 'planned' ? 0 : status === 'pending' ? 1 : 2
          return rank(a.status) - rank(b.status) || a.transactionDate.localeCompare(b.transactionDate)
        }).map((item) => <article key={item.id}>
          <header><div><strong>{item.description}</strong><small>{formatFinanceDate(item.transactionDate)}</small></div><div className="finance-expense-amount"><b>{formatMxn(item.amountCents)}</b><span className={`finance-occurrence-status finance-occurrence-status--${item.status === 'completed' ? 'paid' : item.status}`}>{item.status === 'completed' ? 'Pagado' : item.status === 'pending' ? 'Pospuesto' : statusLabel[item.status]}</span></div></header>
          <div className="finance-expense-meta"><small>{data.accounts.find((account) => account.id === item.accountId)?.name ?? 'Sin cuenta'}{data.categories.find((category) => category.id === item.categoryId)?.name ? ` · ${data.categories.find((category) => category.id === item.categoryId)?.name}` : ''}{item.debtId && ` · Deuda: ${data.debtPlan?.debts.find(debt => debt.id === item.debtId)?.name ?? 'vinculada'}`}</small></div>
          <footer>
            <Button disabled={item.status !== 'planned' || savingPaymentId === item.id} onClick={() => void registerEventualPayment(item)}>{item.status === 'completed' ? 'Pagado' : savingPaymentId === item.id ? 'Registrando…' : 'Registrar pago'}</Button>
            <Button variant="ghost" onClick={() => { setEditingTransaction(item); setDialog('transaction') }}>Editar</Button>
            {item.status === 'planned' && <Button variant="ghost" onClick={() => void status(item, 'pending')}>Posponer</Button>}
            {!['completed', 'cancelled'].includes(item.status) && <Button variant="ghost" onClick={() => void status(item, 'cancelled')}>Cancelar</Button>}
            <Button variant="ghost" icon={<Trash2 size={13} />} onClick={() => setDeleting(item)}>Eliminar</Button>
          </footer>
        </article>)}</FinanceList>
        {!monthlyTransactions.some((item) => !item.recurringTransactionId && (item.type === 'expense' || item.type === 'debt_payment')) && <EmptyState title="Sin gastos eventuales" description="Planea una compra o pago futuro sin afectar todavía tu saldo real." />}
      </section>
    </div>}

    {panel === 'savings' && <SavingsPanel metrics={metrics} annual={annualTotals} year={month.getFullYear()} goals={data.goals} contributions={data.contributions} />}

    {panel === 'fund' && <section className="finance-section finance-fund"><SectionHead eyebrow="Reserva flexible" title="Fondo de Ahorro" action="Registrar movimiento" onClick={() => { setEditingFundEntry(undefined); setDialog('fundEntry') }} /><div className="finance-fund-hero"><div><PiggyBank size={24} /><span>Saldo disponible en el fondo</span><strong>{formatMxn(fundMetrics.balanceCents)}</strong><small>Dinero reservado sin asignarlo a una meta específica.</small></div><div><span>Ritmo del mes</span><strong>{formatMxn(fundMetrics.monthCents)}</strong><small>{fundMetrics.lastEntry ? `Último movimiento · ${fundMetrics.lastEntry.entryDate}` : 'Haz tu primera aportación'}</small></div></div><div className="finance-fund-kpis"><FinanceKpi label="Aportado este año" value={fundMetrics.yearCents} /><FinanceKpi label="Última aportación" value={fundMetrics.lastEntry?.amountCents ?? 0} context={fundMetrics.lastEntry?.entryDate ?? 'Sin movimientos'} /></div><div className="finance-fund-history"><header><span>Fecha</span><span>Concepto</span><span>Monto</span><span>Acciones</span></header>{data.savingsFundEntries.map(item=><article key={item.id}><time>{item.entryDate}</time><span>{item.description??(item.amountCents>0?'Aportación':'Retiro')}</span><strong className={item.amountCents>=0?'positive':'negative'}>{item.amountCents >= 0 ? '+' : '−'}{formatMxn(Math.abs(item.amountCents))}</strong><nav aria-label={`Acciones del fondo: ${item.description ?? item.entryDate}`}><Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => { setEditingFundEntry(item); setDialog('fundEntry') }}>Editar</Button><Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => setDeletingFundEntry(item)}>Eliminar</Button></nav></article>)}{!data.savingsFundEntries.length&&<EmptyState title="Fondo vacío" description="Reserva dinero sin asignarlo a una meta específica." />}</div></section>}

    {panel === 'goals' && <section className="finance-section"><SectionHead eyebrow="Dirección" title="Metas financieras" action="Nueva meta" onClick={() => setDialog('goal')} /><div className="finance-goals">{data.goals.map((goal) => { const progress=goalProgress(goal.id,data);const target=goalTargetCents(goal.id,data);const spent=goalSpentCents(goal.id,data);const available=goalAvailableCents(goal.id,data);return <article className="finance-goal-summary" key={goal.id} onClick={()=>{setSelectedGoal(goal);setDialog('goalDetail')}}><header><Target /><div><strong>{goal.name}</strong><small>{goal.priority} · {goal.status}</small></div><b>{progress.percentage.toFixed(0)}%</b></header><ProgressBar value={progress.percentage}/><div className="finance-goal-metrics"><span>Objetivo total<strong>{formatMxn(target)}</strong></span><span>Total aportado<strong>{formatMxn(progress.savedCents)}</strong></span><span>Total gastado<strong>{formatMxn(spent)}</strong></span><span>Disponible en meta<strong>{formatMxn(available)}</strong></span><span>Pendiente por comprar<strong>{formatMxn(Math.max(0,target-spent))}</strong></span><span>Pendiente por financiar<strong>{formatMxn(Math.max(0,target-progress.savedCents))}</strong></span></div><footer onClick={event=>event.stopPropagation()}><Button variant="secondary" onClick={()=>{setSelectedGoal(goal);setDialog('goalDetail')}}>Ver detalle</Button><Button variant="secondary" onClick={()=>{setSelectedGoal(goal);setDialog('contribution')}}>Registrar aportación</Button><Button variant="ghost" onClick={()=>{setEditingGoal(goal);setDialog('goal')}}>Editar meta</Button>{goal.status==='active'&&<Button variant="ghost" onClick={async()=>{if(!user)return;await financeGoalRepository.save({...goal,status:'paused'},user.id);await finish('Meta pausada.')}}>Pausar</Button>}{goal.status==='paused'&&<Button variant="ghost" onClick={async()=>{if(!user)return;await financeGoalRepository.save({...goal,status:'active'},user.id);await finish('Meta reanudada.')}}>Reanudar</Button>}<Button variant="danger" icon={<Trash2 size={13}/>} onClick={()=>setDeletingGoal(goal)}>Eliminar meta</Button></footer></article>})}</div>{!data.goals.length&&<EmptyState title="Sin metas financieras" description="Convierte una intención de ahorro en una dirección medible."/>}</section>}
    </div>
    {panel !== 'plan' && panel !== 'advisor' && <aside className="finance-side-kpis" aria-label="Resumen financiero" tabIndex={0}><FinanceMetrics metrics={metrics} previous={previous} hasPreviousData={hasPreviousData} midMonthProjection={midMonthProjection} projection={baselineLiquidityProjection} projectionBreakdown={projectionBreakdown} month={month} /></aside>}
    </div>

    <input ref={receiptInputRef} className="finance-receipt-input" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Importar comprobante" onChange={(event) => { const file = event.target.files?.[0]; if (file) setSharedReceipt(file); event.target.value = '' }} />
    {dialog === 'movementMenu' && <MovementMenu canTransfer={activeAccounts.length > 1} onClose={() => setDialog(null)} onSelect={startMovement} onImport={() => { setDialog(null); receiptInputRef.current?.click() }} />}
    {sharedReceipt && <SharedReceiptDialog file={sharedReceipt} accounts={activeAccounts} categories={data.categories} budgets={data.budgets} onClose={() => setSharedReceipt(undefined)} onSave={async (item) => { if (!user) throw new Error('Inicia sesión para guardar el gasto.'); await financeTransactionRepository.save(item, user.id); setSharedReceipt(undefined); await finish('Gasto capturado desde el comprobante.') }} />}
    {dialog === 'transaction' && <TransactionDialog financeData={data} initial={editingTransaction} preset={movementPreset} accounts={data.accounts.filter((item) => item.isActive)} categories={data.categories.filter((item) => item.isActive)} budgets={data.budgets} onClose={() => { setDialog(null); setEditingTransaction(undefined); setMovementPreset(undefined) }} onCreateCategory={async (item) => { if (!user) throw new Error('Inicia sesión para crear una categoría.'); return financeCategoryRepository.save(item, user.id) }} onSave={async (item) => { if (!user) return; await financeTransactionRepository.save(item, user.id); setMovementPreset(undefined); await finish('Movimiento guardado.') }} />}
    {dialog === 'account' && <AccountDialog initial={editingAccount} onClose={() => { setDialog(null); setEditingAccount(undefined) }} onSave={async (item) => { if (!user) return; await financeAccountRepository.save(item, user.id); await finish('Cuenta guardada.') }} />}
    {dialog === 'budget' && <BudgetDialog data={data} month={monthKey(month)} initialHalf={budgetHalfToEdit} initialCategoryId={budgetCategoryToEdit} budgets={data.budgets} categories={data.categories.filter((item) => item.type === 'expense' && item.isActive)} onClose={() => { setDialog(null); setBudgetHalfToEdit(undefined); setBudgetCategoryToEdit(undefined) }} onSave={async (item) => { if (!user) return; await financeBudgetRepository.save(item, user.id); await finish('Presupuesto guardado.') }} onDelete={(item) => { setDialog(null); setDeletingBudget(item) }} />}
    {dialog==='budgetClose'&&closingBudget&&<BudgetCloseDialog budget={closingBudget} performance={budgetPerformance(data,parseISO(closingBudget.periodEnd??closingBudget.month)).find(item=>item.id===closingBudget.id)} goals={data.goals.filter(goal=>goal.status==='active')} onClose={()=>{setDismissedBudgetIds(current=>[...current,closingBudget.id]);setDialog(null);setClosingBudget(undefined)}} onSave={async(destination,goalId)=>{if(!user)return;await financePlanningRepository.closeBudget(closingBudget.id,destination,goalId,user.id);setClosingBudget(undefined);await finish('Cierre de quincena guardado.')}}/>}
    {dialog === 'recurring' && <RecurringDialog
      key={recurringEditMode}
      initial={editingRecurring}
      debts={data.debtPlan?.debts ?? []}
      editMode={recurringEditMode}
      occurrence={editingOccurrence}
      period={selectedPeriod}
      suggestedDate={editingOccurrence?.expectedDate ?? (editingRecurring ? recurringExpectedDate(editingRecurring, month) : format(month, 'yyyy-MM-dd'))}
      presetType={movementPreset?.type}
      accounts={data.accounts.filter((item) => item.isActive)}
      categories={data.categories.filter((item) => item.isActive)}
      onClose={() => { setDialog(null); setEditingRecurring(undefined); setEditingOccurrence(undefined); setMovementPreset(undefined) }}
      onOpenTemplate={editingRecurring && recurringEditMode === 'period' ? () => setRecurringEditMode('template') : undefined}
      onPostpone={editingRecurring ? () => void setRecurringMonthStatus(editingRecurring, editingOccurrence, 'postponed') : undefined}
      onSkip={editingRecurring ? () => void setRecurringMonthStatus(editingRecurring, editingOccurrence, 'skipped') : undefined}
      onToggleActive={editingRecurring ? async () => {
        if (!user) return
        await financeRecurringRepository.setActive(editingRecurring.id, !editingRecurring.isActive, user.id)
        await finish(editingRecurring.isActive ? 'Recurrente pausado.' : 'Recurrente reanudado.')
      } : undefined}
      onRevert={editingRecurring ? () => {
        if (editingOccurrence) setRevertingOccurrence(editingOccurrence)
      } : undefined}
      onSave={async (item) => {
        if (!user) return
        if (editingRecurring && editingOccurrence && recurringEditMode === 'period') {
          await financeRecurringOccurrenceRepository.saveOccurrence(editingOccurrence.id, item.nextOccurrence, item.amountCents, user.id, item.description)
        } else if (editingRecurring && recurringEditMode === 'period') {
          await financeRecurringOccurrenceRepository.savePeriod(item.id, selectedPeriod, item.nextOccurrence, item.amountCents, user.id, item.description)
        } else if (editingRecurring) {
          await financeRecurringRepository.save(item, user.id)
        } else {
          await financeRecurringRepository.save(item, user.id)
          await financeRecurringOccurrenceRepository.savePeriod(item.id, selectedPeriod, item.nextOccurrence, item.amountCents, user.id)
        }
        setMovementPreset(undefined)
        await finish(editingRecurring ? recurringEditMode === 'period' ? 'Periodo recurrente actualizado.' : 'Recurrencia actualizada.' : 'Movimiento recurrente guardado.')
      }}
    />}
    {dialog === 'goal' && <GoalDialog initial={editingGoal} accounts={data.accounts.filter((item) => item.isActive)} onClose={() => { setDialog(null); setEditingGoal(undefined) }} onSave={async (item) => { if (!user) return; await financeGoalRepository.save(item, user.id); await finish('Meta guardada.') }} />}
    {dialog === 'contribution' && <ContributionDialog goal={selectedGoal} goals={data.goals.filter((item) => item.status === 'active')} accounts={data.accounts.filter((item) => item.isActive)} onClose={() => { setDialog(null); setSelectedGoal(undefined) }} onSave={async (item) => { if (!user) return; await financeGoalRepository.contribute(item, user.id); await finish('Aportación registrada y vinculada a la meta.') }} />}
    {dialog === 'fundEntry' && data.savingsFund && <FundEntryEditor fundId={data.savingsFund.id} initial={editingFundEntry} balanceCents={fundMetrics.balanceCents} onClose={() => { setDialog(null); setEditingFundEntry(undefined) }} onSave={async item => { if (!user) return; await financePlanningRepository.saveFundEntry(item, user.id); await finish(editingFundEntry ? 'Movimiento del fondo actualizado.' : 'Movimiento del fondo registrado.') }} />}
    {dialog === 'categories' && <FinanceCategoryManager categories={data.categories} onClose={() => setDialog(null)} onSave={async category => { if (!user) throw new Error('Inicia sesión para administrar categorías.'); await financeCategoryRepository.save(category, user.id); await refresh() }} onDelete={async category => { if (!user) return; await financeCategoryRepository.remove(category.id, user.id); await refresh() }} />}
    {dialog === 'editContribution' && editingContribution && <ReservedContributionEditor initial={editingContribution} goalName={data.goals.find(goal => goal.id === editingContribution.goalId)?.name ?? 'Meta'} onClose={() => { setEditingContribution(undefined); setDialog(selectedGoal ? 'goalDetail' : null) }} onSave={async contribution => { if (!user) return; await financeGoalRepository.updateReservedContribution(contribution, user.id); await finish('Aportación actualizada.') }} />}
    <ConfirmDialog open={Boolean(deletingFundEntry)} title="Eliminar movimiento del fondo" description={`Eliminarás “${deletingFundEntry?.description ?? 'este movimiento'}” del fondo y se recalculará su saldo.`} confirmLabel="Eliminar movimiento" onClose={() => setDeletingFundEntry(undefined)} onConfirm={async () => { if (!user || !deletingFundEntry) return; try { if (fundMetrics.balanceCents - deletingFundEntry.amountCents < 0) throw new Error('Esta aportación ya se utilizó. Corrige primero los retiros vinculados al saldo del fondo.'); await financePlanningRepository.removeFundEntry(deletingFundEntry.id, user.id); setDeletingFundEntry(undefined); await finish('Movimiento del fondo eliminado.') } catch (reason) { setDeletingFundEntry(undefined); setFeedback(reason instanceof Error ? reason.message : 'No se pudo eliminar el movimiento.') } }} />
    <ConfirmDialog open={Boolean(deletingContribution)} title="Eliminar aportación" description={deletingContribution?.transactionId ? 'Se eliminará también el movimiento de ahorro vinculado y se recalcularán los saldos de tu cuenta y tu meta.' : 'Se eliminará la aportación de dinero previamente apartado. No se modificará ningún movimiento de tus cuentas.'} confirmLabel="Eliminar aportación" onClose={() => { setDeletingContribution(undefined); setDialog(selectedGoal ? 'goalDetail' : null) }} onConfirm={async () => { if (!user || !deletingContribution) return; try { if (deletingContribution.transactionId) await financeTransactionRepository.remove(deletingContribution.transactionId, user.id); else await financeGoalRepository.removeReservedContribution(deletingContribution.id, user.id); setDeletingContribution(undefined); await finish('Aportación eliminada.') } catch (reason) { setDeletingContribution(undefined); setFeedback(reason instanceof Error ? reason.message : 'No se pudo eliminar la aportación.') } }} />
    {dialog === 'goalDetail' && selectedGoal && <GoalDetailModal goal={selectedGoal} data={data} onEditContribution={contribution => {
      if (contribution.transactionId) {
        const transaction = data.transactions.find(item => item.id === contribution.transactionId)
        if (!transaction) { setFeedback('Actualiza tus datos para cargar el movimiento de esta aportación.'); return }
        setEditingTransaction(transaction); setDialog('transaction')
      } else { setEditingContribution(contribution); setDialog('editContribution') }
    }} onDeleteContribution={contribution => { setDialog(null); setDeletingContribution(contribution) }} onClose={()=>{setDialog(null);setSelectedGoal(undefined)}} onAdd={()=>{setSelectedGoalItem(undefined);setDialog('goalItem')}} onEdit={item=>{setSelectedGoalItem(item);setDialog('goalItem')}} onPurchase={item=>{setSelectedGoalItem(item);setDialog('purchaseItem')}} onDiscard={async item=>{if(!user)return;await financePlanningRepository.saveGoalItem({...item,status:'discarded'},user.id);await refresh();setFeedback('Artículo descartado.')}} onDelete={item=>setDeletingGoalItem(item)} />}
    {dialog === 'goalItem' && selectedGoal && <GoalItemDialog goal={selectedGoal} initial={selectedGoalItem} onClose={()=>setDialog('goalDetail')} onSave={async item=>{if(!user)return;await financePlanningRepository.saveGoalItem(item,user.id);await refresh();setFeedback('Artículo guardado.');setSelectedGoalItem(undefined);setDialog('goalDetail')}} />}
    {dialog === 'purchaseItem' && selectedGoalItem && <PurchaseItemDialog item={selectedGoalItem} accounts={activeAccounts} categories={data.categories.filter(item=>item.type==='expense'&&item.isActive)} transactions={data.transactions} onClose={()=>setDialog('goalDetail')} onSave={async (item,movement)=>{if(!user)return;if(movement)await financeTransactionRepository.save(movement,user.id);await financePlanningRepository.saveGoalItem(item,user.id);await refresh();setFeedback('Compra vinculada a la meta.');setDialog('goalDetail')}} />}
    <ConfirmDialog open={Boolean(deletingGoalItem)} title={deletingGoalItem?.transactionId?'Conservar movimiento financiero':'Eliminar artículo'} description={deletingGoalItem?.transactionId?'Este artículo tiene un movimiento asociado. El movimiento no se eliminará; el artículo se marcará como descartado.':'El artículo se eliminará definitivamente de la meta. ¿Deseas continuar?'} confirmLabel={deletingGoalItem?.transactionId?'Descartar artículo':'Eliminar'} onClose={()=>setDeletingGoalItem(undefined)} onConfirm={async()=>{if(!user||!deletingGoalItem)return;if(deletingGoalItem.transactionId)await financePlanningRepository.saveGoalItem({...deletingGoalItem,status:'discarded'},user.id);else await financePlanningRepository.removeGoalItem(deletingGoalItem.id,user.id);setDeletingGoalItem(undefined);await refresh();setFeedback(deletingGoalItem.transactionId?'Artículo descartado; el movimiento se conservó.':'Artículo eliminado.')}} />
    <ConfirmDialog open={Boolean(deletingGoal)} title="Eliminar meta" description={`Eliminarás “${deletingGoal?.name ?? ''}” y sus artículos/aportaciones de planeación. Los movimientos financieros reales que registraste se conservarán intactos.`} confirmLabel="Eliminar meta" onClose={()=>setDeletingGoal(undefined)} onConfirm={async()=>{if(!user||!deletingGoal)return;const goal=deletingGoal;try{await financeGoalRepository.remove(goal.id,user.id);setDeletingGoal(undefined);if(selectedGoal?.id===goal.id){setSelectedGoal(undefined);setDialog(null)}await refresh();window.dispatchEvent(new Event('faro:finance-updated'));setFeedback(`Meta “${goal.name}” eliminada. Tus movimientos se conservaron.`)}catch(reason){setDeletingGoal(undefined);setFeedback(reason instanceof Error?reason.message:'No se pudo eliminar la meta.')}}} />
    <ConfirmDialog open={Boolean(deletingBudget)} title="Eliminar presupuesto" description={`Eliminarás el presupuesto “${deletingBudget?.name ?? ''}” de esta quincena. Los gastos realizados y programados permanecerán intactos.`} confirmLabel="Eliminar presupuesto" onClose={() => setDeletingBudget(undefined)} onConfirm={async () => {
      if (!user || !deletingBudget) return
      try {
        await financeBudgetRepository.remove(deletingBudget.id, user.id)
        setDeletingBudget(undefined)
        await finish('Presupuesto eliminado. Tus gastos permanecen intactos.')
      } catch (reason) {
        setDeletingBudget(undefined)
        setFeedback(reason instanceof Error ? reason.message : 'No se pudo eliminar el presupuesto.')
      }
    }} />
    <ConfirmDialog open={Boolean(deleting)} title="Eliminar movimiento" description="Esta acción elimina el movimiento definitivamente y recalcula los saldos. ¿Deseas continuar?" onClose={() => setDeleting(undefined)} onConfirm={async () => { if (!user || !deleting) return; await financeTransactionRepository.remove(deleting.id, user.id); setDeleting(undefined); await finish('Movimiento eliminado.') }} />
    <ConfirmDialog open={Boolean(deletingAccount)} title="Eliminar cuenta definitivamente" description="Solo se eliminará si no tiene movimientos ni relaciones. Si conserva historial, FARO bloqueará la operación y conservará la cuenta. Puedes archivarla desde su tarjeta." onClose={() => setDeletingAccount(undefined)} onConfirm={async () => {
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
    <ConfirmDialog open={Boolean(deletingRecurring)} title="Terminar recurrente" description={`Dejará de programarse desde ${format(month, 'MMMM yyyy', { locale: es })}. Los pagos y periodos anteriores permanecerán intactos.`} confirmLabel="Terminar desde este mes" onClose={() => setDeletingRecurring(undefined)} onConfirm={async () => {
      if (!user || !deletingRecurring) return
      try {
        await financeRecurringRepository.endFromPeriod(deletingRecurring.id, selectedPeriod, user.id)
        setDeletingRecurring(undefined)
        await finish(`Programación terminada desde ${format(month, 'MMMM yyyy', { locale: es })}. El historial se conservó.`)
      } catch (reason) {
        setDeletingRecurring(undefined)
        setFeedback(reason instanceof Error ? reason.message : 'No se pudo terminar el recurrente.')
      }
    }} />
    <ConfirmDialog open={Boolean(revertingOccurrence)} title={revertingOccurrence && data.recurring.find((item) => item.id === revertingOccurrence.recurringTransactionId)?.type === 'income' ? 'Deshacer cobro' : 'Deshacer pago'} description={revertingOccurrence && data.recurring.find((item) => item.id === revertingOccurrence.recurringTransactionId)?.type === 'income' ? 'Se eliminará el movimiento generado y el ingreso volverá a su estado anterior.' : 'Se eliminará el movimiento generado y el gasto volverá a su estado anterior.'} confirmLabel="Deshacer" onClose={() => setRevertingOccurrence(undefined)} onConfirm={() => void revertRecurringPayment()} />
  </div>
}

function RecurringCard({ item, expectedDate, occurrence, account, category, busy, onRegister, onEdit, onDelete }: {
  item: FinanceRecurringTransaction
  expectedDate?: string
  occurrence?: FinanceRecurringOccurrence
  account?: string
  category?: string
  busy: boolean
  onRegister: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const income = item.type === 'income'
  const paid = occurrence?.status === 'paid'
  const configured = Boolean(occurrence?.amountCents && expectedDate)
  const statusText = !item.isActive ? 'Pausado' : paid ? income ? 'Cobrado' : 'Pagado' : occurrence?.status === 'skipped' ? 'Omitido' : occurrence?.status === 'postponed' ? 'Pospuesto' : income ? 'Esperado' : 'Pendiente'
  return <article className={`finance-expense--${occurrence?.status ?? 'pending'} ${!item.isActive ? 'finance-expense--paused' : ''}`}>
    <header><div><strong>{occurrence?.description ?? item.description}</strong><small>{configured ? formatFinanceDate(expectedDate!) : 'Monto y fecha por definir'}</small></div><div className="finance-expense-amount"><b className={income ? 'positive' : ''}>{configured ? formatMxn(occurrence!.amountCents!) : '—'}</b><span className={`finance-occurrence-status finance-occurrence-status--${occurrence?.status ?? 'pending'}`}>{statusText}</span></div></header>
    <div className="finance-expense-meta"><small>{account}{category ? ` · ${category}` : ''}</small></div>
    <footer>
      <Button disabled={paid || !item.isActive || !configured || occurrence?.status === 'skipped' || busy} loading={busy} onClick={onRegister}>{paid ? income ? 'Cobrado' : 'Pagado' : income ? 'Registrar cobro' : 'Registrar pago'}</Button>
      <Button variant="ghost" onClick={onEdit}>Editar</Button>
      <Button variant="ghost" icon={<Trash2 size={13} />} onClick={onDelete}>Eliminar</Button>
    </footer>
  </article>
}

function EventualIncomeCard({ item, account, category, busy, onRegister, onEdit, onStatus, onDelete }: {
  item: FinanceTransaction
  account?: string
  category?: string
  busy: boolean
  onRegister: () => void
  onEdit: () => void
  onStatus: (status: FinanceTransactionStatus) => void
  onDelete: () => void
}) {
  const collected = item.status === 'completed'
  const postponed = item.status === 'pending'
  return <article>
    <header><div><strong>{item.description}</strong><small>{formatFinanceDate(item.transactionDate)} · {collected ? 'Cobrado' : postponed ? 'Pospuesto' : 'Esperado'}</small></div><b className="positive">{formatMxn(item.amountCents)}</b></header>
    <small>{account ?? 'Sin cuenta'} · {category ?? 'Sin categoría'}</small>
    <footer>
      <Button disabled={collected || busy} loading={busy} onClick={onRegister}>{collected ? 'Cobrado' : busy ? 'Registrando…' : 'Registrar cobro'}</Button>
      <Button variant="ghost" onClick={onEdit}>Editar</Button>
      {!collected && <Button variant="ghost" onClick={() => onStatus(postponed ? 'planned' : 'pending')}>{postponed ? 'Marcar esperado' : 'Posponer'}</Button>}
      {!collected && <Button variant="ghost" onClick={() => onStatus('cancelled')}>Cancelar</Button>}
      <Button variant="ghost" icon={<Trash2 size={13} />} onClick={onDelete}>Eliminar</Button>
    </footer>
  </article>
}

function FinanceMetrics({ metrics, previous, hasPreviousData, midMonthProjection, projection, projectionBreakdown, month }: {
  metrics: ReturnType<typeof calculateFinanceMetrics>
  previous: ReturnType<typeof calculateFinanceMetrics>
  hasPreviousData: boolean
  midMonthProjection: { date: string; balanceCents: number }
  projection: ReturnType<typeof financeLiquidityProjection>
  projectionBreakdown: ReturnType<typeof financeProjectionBreakdown>
  month: Date
}) {
  const todayLabel = format(parseISO(projection.currentDate), 'd MMM', { locale: es })
  const selectedMonthLabel = format(month, 'MMMM', { locale: es })
  const previousMonthLabel = projection.openingBalanceSourcePeriod
    ? format(parseISO(projection.openingBalanceSourcePeriod), 'MMM yyyy', { locale: es })
    : ''
  const compareWithPrevious = projection.periodMode === 'past' && hasPreviousData
  const isHistorical = projection.periodMode === 'past'
  const realizedFlowContext = projection.periodMode === 'future'
    ? 'El periodo aún no inicia'
    : projection.periodMode === 'current'
      ? 'Periodo en curso'
      : undefined
  const projectedOpeningCents = metrics.projectedBalanceCents
    - projectionBreakdown.ingresosPendientes
    + projectionBreakdown.gastosPendientes
  const closingContext = projection.periodMode === 'future'
    ? `Base: ${formatMxn(projectedOpeningCents)} · cierre de ${previousMonthLabel}`
    : projection.periodMode === 'current'
      ? 'Saldo de hoy + flujo pendiente'
      : 'Sólo movimientos realizados'
  const midpointContext = isHistorical
    ? 'Sólo movimientos realizados'
    : 'Incluye compromisos y reservas'
  return <section className="finance-kpis finance-kpis--primary" aria-label="Métricas financieras del periodo">
    <div className="finance-kpi-group finance-kpi-group--position">
      <header><span>Posición de hoy</span></header>
      <FinanceKpi tone="available" featured icon={<Landmark />} label="Disponible operativo hoy" value={metrics.availableBalanceCents} context={`Cuentas activas − ahorro − Plan · ${todayLabel}`} />
    </div>
    <div className="finance-kpi-group finance-kpi-group--flow">
      <header><span>Realizado en {selectedMonthLabel}</span></header>
      <FinanceKpi tone="income" icon={<ArrowUpRight />} label="Ingresos cobrados" value={metrics.monthlyIncomeCents} previous={previous.monthlyIncomeCents} hasPrevious={compareWithPrevious} context={realizedFlowContext} />
      <FinanceKpi tone="expense" icon={<ArrowDownRight />} label="Gastos pagados" value={metrics.monthlyExpensesCents} previous={previous.monthlyExpensesCents} hasPrevious={compareWithPrevious} inverse context={realizedFlowContext} />
    </div>
    <div className="finance-kpi-group finance-kpi-group--projection">
      <header><span>{isHistorical ? 'Cierre de' : 'Proyección de'} {selectedMonthLabel}</span></header>
      <FinanceKpi tone="projected" icon={<Clock3 />} label="Saldo total al cierre" value={metrics.projectedBalanceCents} context={closingContext} />
      <FinanceKpi tone="projected" icon={<CalendarDays />} label="Disponible operativo al 15" value={midMonthProjection.balanceCents} context={midpointContext} />
    </div>
  </section>
}

function PeriodFlowChart({ flow }: { flow: { incomeCents: number; expenseCents: number; netCents: number } }) {
  const rows = [
    { name: 'Ingresos', value: flow.incomeCents, color: 'var(--finance-chart-income, #f1f1ef)' },
    { name: 'Gastos', value: -flow.expenseCents, color: 'var(--finance-chart-expense, #858a91)' },
    { name: 'Neto', value: flow.netCents, color: 'var(--finance-chart-net, #c5c8cb)' },
  ]
  const compactAxis = (value: number) => {
    if (value === 0) return '0'
    const amount = Math.abs(value) / 100000
    return `${value < 0 ? '−' : ''}${Number.isInteger(amount) ? amount : amount.toFixed(1)}k`
  }
  return <div className="finance-period-flow__chart">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 26, right: 18, bottom: 8, left: 2 }}>
        <CartesianGrid vertical={false} stroke="var(--finance-chart-grid, #30343a)" strokeDasharray="4 6" />
        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'var(--finance-chart-tick, #a8b0bb)', fontSize: 9 }} interval={0} />
        <YAxis axisLine={false} tickLine={false} width={42} tick={{ fill: 'var(--finance-chart-tick, #9aa4b0)', fontSize: 8 }} tickFormatter={compactAxis} />
        <ReferenceLine y={0} stroke="#62676e" strokeDasharray="4 4" />
        <Tooltip cursor={{ fill: 'rgba(255,255,255,.035)' }} formatter={(value) => formatMxn(Number(value))} contentStyle={{ background: 'var(--finance-tooltip-bg, #1d2024)', border: '1px solid var(--finance-tooltip-border, #44484e)', borderRadius: 10 }} labelStyle={{ color: 'var(--finance-tooltip-text, #f3f3f1)' }} />
        <Bar dataKey="value" maxBarSize={92} radius={[2, 2, 0, 0]}>
          {rows.map((row) => <Cell key={row.name} fill={row.color} />)}
          <LabelList dataKey="value" position="top" formatter={(value) => formatMxn(Number(value ?? 0))} fill="var(--finance-chart-tick, #e5ebf3)" fontSize={9} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    <div className="finance-period-flow__legend"><span><i />Ingresos</span><span><i />Gastos</span><span><i />Resultado neto</span></div>
    <dl className="finance-flow-summary" aria-label="Importes del flujo del periodo"><div><dt>Ingresos</dt><dd>{formatMxn(flow.incomeCents)}</dd></div><div><dt>Gastos</dt><dd>{formatMxn(flow.expenseCents)}</dd></div><div><dt>Resultado neto</dt><dd>{formatMxn(flow.netCents)}</dd></div></dl>
  </div>
}

function SavingsPanel({ metrics, annual, year, goals, contributions }: {
  metrics: ReturnType<typeof calculateFinanceMetrics>
  annual: ReturnType<typeof annualFinanceTotals>
  year: number
  goals: FinanceGoal[]
  contributions: FinanceGoalContribution[]
}) {
  const projections = financeGoalProjections(goals, contributions, new Date())
  const monthlyTarget = projections.reduce((sum, item) => sum + item.requiredMonthlyCents, 0)
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
    <section className="finance-goal-projections">
      <header><div><span className="eyebrow">Ruta de ahorro</span><h3>Proyección de tus metas</h3></div><div><small>Aportación mensual sugerida</small><strong>{formatMxn(monthlyTarget)}</strong></div></header>
      {projections.length ? <div>{projections.map((projection) => <article key={projection.goal.id}>
        <header><div><strong>{projection.goal.name}</strong><small>{projection.targetLabel}</small></div><span className={`finance-projection-status finance-projection-status--${projection.status}`}>{projection.statusLabel}</span></header>
        <ProgressBar value={projection.progressPercentage} />
        <div className="finance-projection-metrics"><span>Falta<strong>{formatMxn(projection.remainingCents)}</strong></span><span>Necesitas al mes<strong>{formatMxn(projection.requiredMonthlyCents)}</strong></span><span>Ritmo reciente<strong>{formatMxn(projection.averageMonthlyCents)}</strong></span></div>
        <p>{projection.insight}</p>
      </article>)}</div> : <EmptyState title="Sin metas activas" description="Crea una meta con fecha objetivo para calcular una ruta mensual." />}
    </section>
  </section>
}

function FinanceKpi({ icon, label, value, previous, inverse, text, featured, hasPrevious, context, tone = 'neutral' }: { icon?: React.ReactNode; label: string; value?: number; previous?: number; inverse?: boolean; text?: string; featured?: boolean; hasPrevious?: boolean; context?: string; tone?: 'neutral' | 'available' | 'actual' | 'income' | 'expense' | 'projected' }) {
  const delta = hasPrevious && previous != null && value != null ? value - previous : null
  const good = delta == null || (inverse ? delta <= 0 : delta >= 0)
  return <article className={`finance-kpi finance-kpi--${tone}${featured ? ' finance-kpi--featured' : ''}`}>{icon}<span>{label}</span><strong>{text ?? formatMxn(value ?? 0)}</strong>{context ? <small>{context}</small> : hasPrevious ? <small className={good ? 'positive' : 'negative'}>{delta === 0 ? 'Sin cambio' : `${(delta ?? 0) > 0 ? '+' : ''}${formatMxn(delta ?? 0)} vs anterior`}</small> : previous != null && <small>Sin datos del periodo anterior</small>}</article>
}
type Projection = { recurringCents: number; eventualCents: number; totalCents: number; realizedCents: number; pendingCents: number; pendingCount: number; budgetReservationCents: number }
function projectionItems(projection: Projection) {
  const reserveContext = projection.budgetReservationCents > 0
    ? `Incluye ${formatMxn(projection.budgetReservationCents)} de presupuesto reservado`
    : undefined
  const pendingContext = projection.budgetReservationCents > 0
    ? `${projection.pendingCount} compromiso${projection.pendingCount === 1 ? '' : 's'} + reserva por aplicar`
    : `${projection.pendingCount} compromiso${projection.pendingCount === 1 ? '' : 's'} por liquidar`
  return [
    { icon: <Repeat2 />, label: 'Recurrente proyectado', value: projection.recurringCents, tone: 'accent' as const },
    { icon: <CalendarDays />, label: 'Eventual proyectado', value: projection.eventualCents, tone: 'accent' as const },
    { icon: <Calculator />, label: 'Total proyectado', value: projection.totalCents, context: reserveContext },
    { icon: <Check />, label: 'Realizado', value: projection.realizedCents, tone: 'positive' as const },
    { icon: <Clock3 />, label: 'Pendiente', value: projection.pendingCents, context: pendingContext, tone: 'negative' as const },
  ]
}
function ProjectionStrip({ items, compact = false }: { items: { icon?: React.ReactNode; label: string; value?: number; text?: string; context?: string; tone?: 'accent' | 'positive' | 'negative' | 'muted' | 'savings' }[]; compact?: boolean }) {
  return <section className={`finance-projection-strip${compact ? ' finance-projection-strip--compact' : ''}`} aria-label="Previsión del periodo">
    {items.map((item) => <article key={item.label}>{item.icon && <i className={`finance-projection-strip__icon finance-projection-strip__icon--${item.tone ?? 'default'}`}>{item.icon}</i>}<span>{item.label}</span><strong className={item.tone}>{item.text ?? formatMxn(item.value ?? 0)}</strong>{item.context && <small>{item.context}</small>}</article>)}
  </section>
}
function SectionHead({ eyebrow, title, action, actionLabel, onClick }: { eyebrow: string; title: string; action: string; actionLabel?: string; onClick: () => void }) {
  const compactAction = action === '+'
  return <header className="finance-section__head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><Button className={compactAction ? 'finance-section__add' : undefined} aria-label={actionLabel} icon={compactAction ? <Plus size={22} strokeWidth={2.25} /> : <Plus size={14} />} onClick={onClick}>{compactAction ? '' : action}</Button></header>
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

function MovementMenu({ canTransfer, onClose, onSelect, onImport }: { canTransfer: boolean; onClose: () => void; onSelect: (preset: MovementPreset) => void; onImport: () => void }) {
  const options: Array<[string, MovementPreset, string]> = [
    ['Registrar ingreso', { type: 'income', categoryName: 'Sueldo' }, 'Dinero que entra'],
    ['Registrar gasto', { type: 'expense' }, 'Gasto fijo o variable'],
    ['Registrar ahorro', { type: 'saving', categoryName: 'Ahorro' }, 'Separar dinero para ahorrar'],
    ['Registrar inversión', { type: 'saving', categoryName: 'Inversión' }, 'Se registra como flujo de ahorro'],
    ['Registrar aportación', { contribution: true }, 'Vincular ahorro a una meta financiera'],
    ['Transferencia', { type: 'transfer' }, 'Mover dinero entre cuentas'],
  ]
  return <Modal open panelClassName="finance-dialog" title="Nuevo movimiento" onClose={onClose}><div className="finance-movement-menu">{options.map(([label, preset, description]) => { const disabled = (preset.type === 'transfer' && !canTransfer); return <button key={label} disabled={disabled} title={disabled ? 'Necesitas al menos dos cuentas activas para mover dinero entre ellas.' : undefined} onClick={() => onSelect(preset)}><span>{label}</span><small>{disabled ? 'Crea o restaura otra cuenta para transferir' : description}</small><ArrowRight size={15} /></button> })}<button type="button" onClick={onImport}><span><FileUp size={15} /> Importar comprobante</span><small>Lee una imagen de Nu y prepara el gasto</small><ArrowRight size={15} /></button></div></Modal>
}

function TransactionDialog({ financeData, initial, preset, accounts, categories, budgets, onClose, onCreateCategory, onSave }: { financeData: FinanceData; initial?: FinanceTransaction; preset?: MovementPreset; accounts: FinanceAccount[]; categories: FinanceCategory[]; budgets: Array<{id:string;name?:string;periodStart?:string;periodEnd?:string}>; onClose: () => void; onCreateCategory: (item: FinanceCategory) => Promise<FinanceCategory>; onSave: (item: Omit<FinanceTransaction, 'createdAt' | 'updatedAt'>) => Promise<void> }) {
  const [type, setType] = useState<FinanceTransactionType>(initial?.type ?? preset?.type ?? 'expense')
  const [amount, setAmount] = useState(initial ? String(initial.amountCents / 100) : '')
  const [date, setDate] = useState(initial?.transactionDate ?? format(new Date(), 'yyyy-MM-dd'))
  const [description, setDescription] = useState(initial?.description ?? '')
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? '')
  const [destinationAccountId, setDestinationAccountId] = useState(initial?.destinationAccountId ?? '')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories.find((item) => item.name === preset?.categoryName)?.id ?? '')
  const [status, setStatus] = useState<FinanceTransactionStatus>(initial?.status ?? preset?.status ?? 'completed')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [budgetId,setBudgetId]=useState(initial?.budgetId??'')
  const [debtId, setDebtId] = useState(initial?.debtId ?? '')
  const [planAmount, setPlanAmount] = useState(String((initial?.planAmountCents ?? 0) / 100))
  const [principal, setPrincipal] = useState(initial?.debtPrincipalCents == null ? '' : String(initial.debtPrincipalCents / 100))
  const [settlement, setSettlement] = useState(initial?.debtSettlement ?? false)
  const [newCategories, setNewCategories] = useState<FinanceCategory[]>([])
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [creatingCategorySaving, setCreatingCategorySaving] = useState(false)
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  const availableCategories = [...categories, ...newCategories]
  const categoryType = categoryTypeForTransaction(type)
  const selectedCategoryName = availableCategories.find((item) => item.id === categoryId)?.name?.trim().toLocaleLowerCase('es-MX')
  const isPersonalExpense = type === 'expense' && (selectedCategoryName === 'personal' || selectedCategoryName === 'gastos personales')
  const automaticBudget = isPersonalExpense ? personalBudgetForDate(budgets, date) : undefined
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const result = financeTransactionSchema.safeParse({ type, amountCents: moneyToCents(amount), transactionDate: date, description, accountId, destinationAccountId: destinationAccountId || undefined, categoryId: categoryId || undefined, status, notes: notes || undefined,budgetId:isPersonalExpense?automaticBudget?.id:budgetId||undefined })
    if (!result.success) return setError(result.error.issues[0]?.message ?? 'Revisa los campos.')
    if (debtId && (type === 'expense' || type === 'debt_payment')) {
      const funded = moneyToCents(planAmount || '0')
      const availablePlan = debtPlanBalanceCents(financeData, accountId) + (initial?.accountId === accountId && initial.status === 'completed' ? initial.planAmountCents ?? 0 : 0)
      if (funded < 0 || funded > result.data.amountCents || (status === 'completed' && funded > availablePlan)) return setError('El monto de Plan supera el pago o el saldo reservado en esta cuenta.')
      if (principal && (moneyToCents(principal) < 0 || moneyToCents(principal) > result.data.amountCents)) return setError('El abono al saldo no puede superar el monto del pago.')
    }
    setSaving(true); setError('')
    try { await onSave({ id: initial?.id ?? crypto.randomUUID(), ...result.data, legacyTransactionId: initial?.legacyTransactionId,
      recurringTransactionId: initial?.recurringTransactionId,
      debtId: type === 'expense' || type === 'debt_payment' ? debtId || undefined : undefined,
      debtPrincipalCents: type === 'expense' || type === 'debt_payment' ? principal ? moneyToCents(principal) : undefined : undefined,
      debtSettlement: (type === 'expense' || type === 'debt_payment') && Boolean(debtId) && settlement,
      planAmountCents: type === 'expense' || type === 'debt_payment' ? debtId ? moneyToCents(planAmount || '0') : 0 : 0,
    }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar.') }
    finally { setSaving(false) }
  }
  const matchingCategories = availableCategories.filter((item) => item.type === categoryType)
  const createCategory = async () => {
    if (!categoryType) return
    const name = newCategoryName.trim().replace(/\s+/g, ' ')
    if (!name) { setError('Escribe el nombre de la nueva categoría.'); return }
    const existing = matchingCategories.find((item) => item.name.localeCompare(name, 'es', { sensitivity: 'accent' }) === 0)
    if (existing) {
      setCategoryId(existing.id); setNewCategoryName(''); setCreatingCategory(false); setError('')
      return
    }
    setCreatingCategorySaving(true); setError('')
    try {
      const category = await onCreateCategory({ id: crypto.randomUUID(), name, type: categoryType, isDefault: false, isActive: true })
      setNewCategories((current) => [...current, category])
      setCategoryId(category.id); setNewCategoryName(''); setCreatingCategory(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo crear la categoría.')
    } finally {
      setCreatingCategorySaving(false)
    }
  }
  const changeType = (next: FinanceTransactionType) => {
    setType(next); setCategoryId(''); setCreatingCategory(false); setNewCategoryName(''); setError('')
  }
  return <Modal open panelClassName="finance-dialog" title={initial ? 'Editar movimiento' : 'Nuevo movimiento'} onClose={onClose}><form className="finance-form" onSubmit={submit}><div className="finance-form-grid"><label>Tipo<select value={type} onChange={(event) => changeType(event.target.value as FinanceTransactionType)}>{Object.entries(typeLabel).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Monto MXN<input type="number" min=".01" step=".01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label></div><label>Descripción<input autoFocus required maxLength={160} value={description} onChange={(event) => setDescription(event.target.value)} /></label><div className="finance-form-grid"><label>Fecha<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Estado<select value={status} onChange={(event) => setStatus(event.target.value as FinanceTransactionStatus)}>{Object.entries(statusLabel).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div><label>Cuenta<select required value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Selecciona</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{type === 'transfer' ? <label>Cuenta destino<select required value={destinationAccountId} onChange={(event) => setDestinationAccountId(event.target.value)}><option value="">Selecciona</option>{accounts.filter((item) => item.id !== accountId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <><div className="finance-category-field"><label>Categoría<select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Selecciona</option>{matchingCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><Button type="button" variant="secondary" size="sm" icon={<Plus size={13} />} onClick={() => { setCreatingCategory((current) => !current); setError('') }}>Nueva categoría</Button></div>{creatingCategory && categoryType && <div className="finance-new-category"><div><strong>Nueva categoría de {categoryTypeLabel[categoryType]}</strong><small>Se guarda en tu cuenta y estará disponible en FARO Desktop y Mobile.</small></div><div><input autoFocus aria-label="Nombre de la nueva categoría" maxLength={60} placeholder="Ej. Deudas" value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void createCategory() } }} /><Button type="button" size="sm" loading={creatingCategorySaving} onClick={() => void createCategory()}>Añadir</Button></div></div>}{isPersonalExpense?<p className="finance-form-hint">{automaticBudget?`Vinculado automáticamente a Gastos Personales · ${automaticBudget.periodStart} — ${automaticBudget.periodEnd}`:'No existe un presupuesto personal para la fecha elegida. El gasto se guardará sin presupuesto.'}</p>:type==='expense'&&<label>Presupuesto asociado <span>opcional</span><select value={budgetId} onChange={event=>setBudgetId(event.target.value)}><option value="">Sin presupuesto</option>{budgets.map(item=><option key={item.id} value={item.id}>{item.name??'Gastos Personales'} · {item.periodStart}</option>)}</select></label>}</>}{(type === 'expense' || type === 'debt_payment') && <DebtMovementFields data={financeData} debtId={debtId} accountId={accountId} onDebt={value => { setDebtId(value); setPlanAmount('0'); setPrincipal(''); setSettlement(false) }} planAmount={planAmount} onPlanAmount={setPlanAmount} principal={principal} onPrincipal={setPrincipal} settlement={settlement} onSettlement={setSettlement} />} <label>Notas<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label><p className="privacy-note">No ingreses números de cuenta, tarjeta ni credenciales bancarias.</p><ErrorText value={error} /><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button></div></form></Modal>
}

function GoalDetailModal({goal,data,onClose,onAdd,onEdit,onPurchase,onDiscard,onDelete,onEditContribution,onDeleteContribution}:{goal:FinanceGoal;data:FinanceData;onClose:()=>void;onAdd:()=>void;onEdit:(item:FinanceGoalItem)=>void;onPurchase:(item:FinanceGoalItem)=>void;onDiscard:(item:FinanceGoalItem)=>Promise<void>;onDelete:(item:FinanceGoalItem)=>void;onEditContribution:(item:FinanceGoalContribution)=>void;onDeleteContribution:(item:FinanceGoalContribution)=>void}) {
  const progress=goalProgress(goal.id,data);const target=goalTargetCents(goal.id,data);const spent=goalSpentCents(goal.id,data);const available=goalAvailableCents(goal.id,data)
  const items=data.goalItems.filter(item=>item.goalId===goal.id)
  return <Modal open panelClassName="finance-dialog finance-goal-detail-modal" title={`Detalle · ${goal.name}`} onClose={onClose}><div className="finance-goal-detail">
    <div className="finance-goal-detail__summary"><span>Objetivo<strong>{formatMxn(target)}</strong></span><span>Aportado<strong>{formatMxn(progress.savedCents)}</strong></span><span>Gastado<strong>{formatMxn(spent)}</strong></span><span>Disponible<strong>{formatMxn(available)}</strong></span><span>Por comprar<strong>{formatMxn(Math.max(0,target-spent))}</strong></span><span>Por financiar<strong>{formatMxn(Math.max(0,target-progress.savedCents))}</strong></span></div>
    <div className="finance-goal-detail__heading"><div><span className="eyebrow">Artículos</span><strong>{items.length} registrados</strong></div><Button size="sm" icon={<Plus size={14}/>} onClick={onAdd}>Añadir artículo</Button></div>
    <div className="finance-goal-item-list">{items.map(item=>{const movement=data.transactions.find(transaction=>transaction.id===item.transactionId);return <article key={item.id} onClick={()=>onEdit(item)}><div><strong>{item.name}</strong><small>{item.url?<a href={item.url} target="_blank" rel="noreferrer" onClick={event=>event.stopPropagation()}>Abrir enlace <ArrowUpRight size={11}/></a>:'Sin enlace'}</small></div><b>{formatMxn(item.priceCents)}</b><span>{item.priority}</span><span>{item.status}</span><small>{item.purchaseDate??'Sin compra'}</small><small title={movement?.description}>{movement?`Movimiento: ${movement.description}`:'Sin movimiento'}</small><nav onClick={event=>event.stopPropagation()}><button onClick={()=>onEdit(item)}>Editar</button>{item.status==='pending'&&<button onClick={()=>onPurchase(item)}>Comprar</button>}{item.status!=='discarded'&&<button onClick={()=>void onDiscard(item)}>Descartar</button>}<button className="danger" onClick={()=>onDelete(item)}>Eliminar</button></nav></article>})}{!items.length&&<EmptyState title="Sin artículos" description="Añade el primer artículo de esta meta." action={<Button onClick={onAdd}>Añadir artículo</Button>}/>}</div>

    <section className="finance-contribution-history" aria-label="Aportaciones de la meta"><h3>Aportaciones</h3><div className="finance-record-list">{data.contributions.filter(item => item.goalId === goal.id).map(item => <article key={item.id}>
      <div><strong>{formatMxn(item.amountCents)}</strong><small>{formatFinanceDate(item.contributionDate)} · {item.transactionId ? 'Movimiento vinculado' : 'Dinero previamente apartado'}</small><small>{item.description ?? item.notes}</small></div>
      <nav aria-label={`Acciones de aportación ${formatMxn(item.amountCents)}`}><Button size="sm" variant="ghost" onClick={() => onEditContribution(item)}>Editar</Button><Button size="sm" variant="ghost" onClick={() => onDeleteContribution(item)}>Eliminar</Button></nav>
    </article>)}</div>{!data.contributions.some(item => item.goalId === goal.id) && <p className="finance-form-hint">Aún no hay aportaciones registradas.</p>}</section>
</div></Modal>
}

function GoalItemDialog({goal,initial,onClose,onSave}:{goal:FinanceGoal;initial?:FinanceGoalItem;onClose:()=>void;onSave:(item:Omit<FinanceGoalItem,'createdAt'|'updatedAt'>)=>Promise<void>}){const[name,setName]=useState(initial?.name??'');const[price,setPrice]=useState(initial?String(initial.priceCents/100):'');const[priority,setPriority]=useState<FinanceGoalItem['priority']>(initial?.priority??'medium');const[url,setUrl]=useState(initial?.url??'');const[notes,setNotes]=useState(initial?.notes??'');const[status,setStatus]=useState<FinanceGoalItem['status']>(initial?.status??'pending');const[error,setError]=useState('');return <Modal open panelClassName="finance-dialog" title={`Artículo · ${goal.name}`} onClose={onClose}><form className="finance-form" onSubmit={async event=>{event.preventDefault();if(!name.trim()||moneyToCents(price)<=0)return setError('Completa nombre y precio.');try{await onSave({id:initial?.id??crypto.randomUUID(),goalId:goal.id,name:name.trim(),priceCents:moneyToCents(price),priority,url:url||undefined,notes:notes||undefined,status,purchaseDate:initial?.purchaseDate,transactionId:initial?.transactionId})}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo guardar.')}}}><label>Nombre<input autoFocus required value={name} onChange={event=>setName(event.target.value)}/></label><div className="finance-form-grid"><label>Precio<input type="number" min=".01" step=".01" required value={price} onChange={event=>setPrice(event.target.value)}/></label><label>Prioridad<select value={priority} onChange={event=>setPriority(event.target.value as typeof priority)}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label></div><label>Enlace opcional<input type="url" value={url} onChange={event=>setUrl(event.target.value)}/></label><label>Notas <span>opcional</span><textarea rows={3} value={notes} onChange={event=>setNotes(event.target.value)}/></label><label>Estado<select value={status} onChange={event=>setStatus(event.target.value as typeof status)}><option value="pending">Pendiente</option><option value="purchased">Comprado</option><option value="discarded">Descartado</option></select></label><ErrorText value={error}/><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar</Button></div></form></Modal>}

function PurchaseItemDialog({item,accounts,categories,transactions,onClose,onSave}:{item:FinanceGoalItem;accounts:FinanceAccount[];categories:{id:string;name:string}[];transactions:FinanceTransaction[];onClose:()=>void;onSave:(item:Omit<FinanceGoalItem,'createdAt'|'updatedAt'>,movement?:Omit<FinanceTransaction,'createdAt'|'updatedAt'>)=>Promise<void>}){const[mode,setMode]=useState<'new'|'existing'|'none'>('new');const[date,setDate]=useState(format(new Date(),'yyyy-MM-dd'));const[accountId,setAccountId]=useState(accounts[0]?.id??'');const[categoryId,setCategoryId]=useState(categories[0]?.id??'');const[transactionId,setTransactionId]=useState('');const[error,setError]=useState('');return <Modal open panelClassName="finance-dialog" title={`Confirmar compra · ${item.name}`} onClose={onClose}><form className="finance-form" onSubmit={async event=>{event.preventDefault();if(mode==='new'&&(!accountId||!categoryId))return setError('Selecciona cuenta y categoría.');if(mode==='existing'&&!transactionId)return setError('Selecciona un movimiento.');const movementId=mode==='new'?crypto.randomUUID():mode==='existing'?transactionId:undefined;const movement=mode==='new'?{id:movementId!,accountId,categoryId,type:'expense' as const,amountCents:item.priceCents,transactionDate:date,description:item.name,status:'completed' as const}:undefined;try{await onSave({id:item.id,goalId:item.goalId,name:item.name,priceCents:item.priceCents,priority:item.priority,url:item.url,status:'purchased',purchaseDate:date,transactionId:movementId},movement)}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo confirmar.')}}}><label>Registro de compra<select value={mode} onChange={event=>setMode(event.target.value as typeof mode)}><option value="new">Crear movimiento nuevo</option><option value="existing">Vincular movimiento existente</option><option value="none">Marcar comprado sin movimiento</option></select></label><label>Fecha de compra<input type="date" value={date} onChange={event=>setDate(event.target.value)}/></label>{mode==='new'&&<><label>Cuenta<select value={accountId} onChange={event=>setAccountId(event.target.value)}>{accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Categoría<select value={categoryId} onChange={event=>setCategoryId(event.target.value)}>{categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label></>}{mode==='existing'&&<label>Movimiento<select value={transactionId} onChange={event=>setTransactionId(event.target.value)}><option value="">Selecciona</option>{transactions.filter(transaction=>transaction.type==='expense').map(transaction=><option key={transaction.id} value={transaction.id}>{transaction.transactionDate} · {transaction.description} · {formatMxn(transaction.amountCents)}</option>)}</select></label>}<ErrorText value={error}/><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">Confirmar compra</Button></div></form></Modal>}

function AccountDialog({ initial, onClose, onSave }: { initial?: FinanceAccount; onClose: () => void; onSave: (item: Omit<FinanceAccount, 'createdAt' | 'updatedAt'>) => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? ''); const [type, setType] = useState<FinanceAccount['type']>(initial?.type ?? 'checking')
  const [balance, setBalance] = useState(initial ? String(initial.initialBalanceCents / 100) : ''); const [limit, setLimit] = useState(initial?.creditLimitCents == null ? '' : String(initial.creditLimitCents / 100))
  const [closingDay, setClosingDay] = useState(initial?.closingDay ? String(initial.closingDay) : ''); const [paymentDay, setPaymentDay] = useState(initial?.paymentDay ? String(initial.paymentDay) : '')
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => { event.preventDefault(); const result = financeAccountSchema.safeParse({ name, type, initialBalanceCents: moneyToCents(balance || '0'), creditLimitCents: limit ? moneyToCents(limit) : undefined, closingDay: closingDay ? Number(closingDay) : undefined, paymentDay: paymentDay ? Number(paymentDay) : undefined }); if (!result.success) return setError(result.error.issues[0]?.message ?? 'Revisa los campos.'); setSaving(true); try { await onSave({ id: initial?.id ?? crypto.randomUUID(), ...result.data, currency: initial?.currency ?? 'MXN', isActive: initial?.isActive ?? true }) } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar.') } finally { setSaving(false) } }
  return <Modal open panelClassName="finance-dialog" title={initial ? 'Editar cuenta' : 'Nueva cuenta'} onClose={onClose}><form className="finance-form" onSubmit={submit}><label>Nombre<input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. BBVA Débito" /></label><div className="finance-form-grid"><label>Tipo<select value={type} onChange={(event) => setType(event.target.value as FinanceAccount['type'])}><option value="cash">Efectivo</option><option value="checking">Débito</option><option value="savings">Ahorro</option><option value="credit">Crédito</option><option value="investment">Inversión</option><option value="loan">Préstamo</option></select></label><label>Saldo inicial MXN<input type="number" step=".01" value={balance} onChange={(event) => setBalance(event.target.value)} /></label></div>{type === 'credit' && <><label>Límite de crédito<input type="number" min="0" step=".01" value={limit} onChange={(event) => setLimit(event.target.value)} /></label><div className="finance-form-grid"><label>Día de corte<input type="number" min="1" max="31" value={closingDay} onChange={(event) => setClosingDay(event.target.value)} /></label><label>Día de pago<input type="number" min="1" max="31" value={paymentDay} onChange={(event) => setPaymentDay(event.target.value)} /></label></div></>}<ErrorText value={error} /><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}>Guardar</Button></div></form></Modal>
}

function BudgetDialog({ data, month, initialHalf, initialCategoryId, budgets, categories, onClose, onSave, onDelete }: { data: FinanceData; month: string; initialHalf?: 'q1' | 'q2'; initialCategoryId?: string; budgets: FinanceBudget[]; categories: { id: string; name: string }[]; onClose: () => void; onSave: (item: { categoryId: string; month: string; plannedAmountCents: number;name:string;periodStart:string;periodEnd:string;carryOverEnabled:boolean }) => Promise<void>; onDelete: (item: FinanceBudget) => void }) {
  const current = new Date()
  const currentMonth = format(current, 'yyyy-MM') === month.slice(0, 7)
  const [half, setHalf] = useState<'q1' | 'q2'>(initialHalf ?? (currentMonth && current.getDate() > 15 ? 'q2' : 'q1'))
  const period = fortnightPeriodForMonth(month, half)
  const personalCategory = categories.find((item) => item.name.trim().toLocaleLowerCase('es-MX') === 'personal')
  const initialCategory = initialCategoryId ?? personalCategory?.id ?? categories[0]?.id ?? ''
  const initialBudget = budgets.find((budget) => budget.categoryId === initialCategory
    && budget.periodStart === period.periodStart && budget.periodEnd === period.periodEnd)
  const [categoryId, setCategoryId] = useState(initialCategory)
  const existingBudget = useMemo(() => budgets.find((budget) => budget.categoryId === categoryId
    && budget.periodStart === period.periodStart && budget.periodEnd === period.periodEnd), [budgets, categoryId, period.periodEnd, period.periodStart])
  const carryOverCents = useMemo(() => personalBudgetCarryOverIntoPeriod(data, period.periodStart), [data, period.periodStart])
  const [amount, setAmount] = useState(initialBudget ? String(initialBudget.plannedAmountCents / 100) : '')
  const [carryOverEnabled, setCarryOverEnabled] = useState(initialBudget?.carryOverEnabled ?? false)
  const [error, setError] = useState('')
  const loadBudget = (nextHalf: 'q1' | 'q2', nextCategoryId: string) => {
    const nextPeriod = fortnightPeriodForMonth(month, nextHalf)
    const nextBudget = budgets.find((budget) => budget.categoryId === nextCategoryId
      && budget.periodStart === nextPeriod.periodStart && budget.periodEnd === nextPeriod.periodEnd)
    setHalf(nextHalf)
    setCategoryId(nextCategoryId)
    setAmount(nextBudget ? String(nextBudget.plannedAmountCents / 100) : '')
    setCarryOverEnabled(nextBudget?.carryOverEnabled ?? false)
    setError('')
  }

  const selectedCategory = categories.find((item) => item.id === categoryId)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const result = financeBudgetSchema.safeParse({ categoryId, month: period.month, plannedAmountCents: moneyToCents(amount) })
    if (!result.success) return setError(result.error.issues[0]?.message ?? 'Revisa los campos.')
    try {
      await onSave({ ...result.data, name: budgetNameForCategory(selectedCategory?.name ?? 'Presupuesto'), periodStart: period.periodStart, periodEnd: period.periodEnd, carryOverEnabled: selectedCategory?.id === personalCategory?.id && carryOverEnabled })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar.')
    }
  }

  return <Modal open panelClassName="finance-dialog" title="Presupuesto quincenal" onClose={onClose}><form className="finance-form" onSubmit={submit}>
    <label>Quincena<select value={half} onChange={(event) => loadBudget(event.target.value as 'q1' | 'q2', categoryId)}><option value="q1">Q1 · del 1 al 15</option><option value="q2">Q2 · del 16 al cierre</option></select></label>
    <p className="finance-form-hint">{period.periodStart} — {period.periodEnd}. Se reserva en los balances proyectados de esta quincena; la línea temporal sólo muestra gastos y compromisos con fecha.</p>
    <label>Categoría vinculada<select value={categoryId} onChange={(event) => loadBudget(half, event.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
    <label>{half === 'q2' ? 'Monto para Q2 MXN' : 'Monto para Q1 MXN'}<input autoFocus type="number" min="0" step=".01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
    {selectedCategory?.id === personalCategory?.id && <label className="finance-budget-carry"><input type="checkbox" checked={carryOverEnabled} onChange={(event) => setCarryOverEnabled(event.target.checked)} /><span><strong>Acumular sobrante anterior</strong><small>{carryOverEnabled ? `Se agregarán ${formatMxn(carryOverCents)} disponibles del período anterior.` : 'Cada quincena conservará únicamente el monto que captures.'}</small></span></label>}
    {existingBudget && <p className="finance-form-hint">Ya hay un presupuesto para esta quincena: al guardar actualizarás su monto.</p>}
    <ErrorText value={error} /><div className="modal-actions">{existingBudget && <Button className="finance-budget-delete" type="button" variant="danger" icon={<Trash2 size={13} />} onClick={() => onDelete(existingBudget)}>Eliminar presupuesto</Button>}<Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">{existingBudget ? 'Actualizar presupuesto' : 'Guardar presupuesto'}</Button></div>
  </form></Modal>
}

function BudgetCloseDialog({ budget, performance, goals, onClose, onSave }: { budget: FinanceBudget; performance?: { actualCents: number; remainingCents: number }; goals: FinanceGoal[]; onClose: () => void; onSave: (destination: 'next_period' | 'goal' | 'savings_fund' | 'available', goalId?: string) => Promise<void> }) {
  const remaining = performance?.remainingCents ?? budget.plannedAmountCents
  const exceeded = remaining < 0
  const [destination, setDestination] = useState<'next_period' | 'goal' | 'savings_fund' | 'available'>(exceeded ? 'available' : 'next_period')
  const [goalId, setGoalId] = useState(goals[0]?.id ?? '')
  const [error, setError] = useState('')
  const actual = performance?.actualCents ?? 0
  const outcomeLabel = exceeded ? 'Exceso registrado' : 'Sobrante disponible'
  const periodLabel = budget.periodStart && budget.periodEnd
    ? `${formatFinanceDate(budget.periodStart)} — ${formatFinanceDate(budget.periodEnd)}`
    : 'Periodo que estás por cerrar'

  return <Modal open title="Cierre de quincena" panelClassName={`finance-dialog finance-budget-close-modal${exceeded ? ' finance-budget-close-modal--exceeded' : ''}`} onClose={onClose}>
    <form className="finance-form finance-close-form" onSubmit={async (event) => {
      event.preventDefault()
      const effectiveDestination = exceeded ? 'available' : destination
      if (effectiveDestination === 'goal' && !goalId) return setError('Selecciona una meta.')
      try {
        await onSave(effectiveDestination, effectiveDestination === 'goal' ? goalId : undefined)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'No se pudo cerrar el periodo.')
      }
    }}>
      <div className="finance-close-intro">
        <span>Resumen del periodo</span>
        <p>{periodLabel}</p>
      </div>

      <div className="finance-close-summary" aria-label="Resumen del cierre">
        <div><span>Presupuesto</span><strong>{formatMxn(budget.plannedAmountCents)}</strong></div>
        <div><span>Gastado</span><strong>{formatMxn(actual)}</strong></div>
        <div className={exceeded ? 'finance-close-summary__result finance-close-summary__result--negative' : 'finance-close-summary__result'}><span>{exceeded ? 'Exceso' : 'Sobrante'}</span><strong>{formatMxn(Math.abs(remaining))}</strong></div>
      </div>

      <section className="finance-close-outcome" aria-live="polite">
        <span>{outcomeLabel}</span>
        <strong>{exceeded ? 'Esta quincena superó el límite planeado.' : 'Esta quincena quedó dentro del límite planeado.'}</strong>
        <p>{exceeded
          ? 'El exceso queda registrado en este periodo. La siguiente quincena se crea con tu presupuesto base, sin arrastrar deuda ni reducir su límite.'
          : 'Elige el destino del sobrante antes de crear automáticamente la siguiente quincena con tu mismo presupuesto base.'}
        </p>
      </section>

      {!exceeded && <div className="finance-close-options">
        <label>Destino del sobrante
          <select value={destination} onChange={(event) => setDestination(event.target.value as typeof destination)}>
            <option value="next_period">Sumarlo al límite del siguiente periodo</option>
            <option value="goal">Aportarlo a una meta</option>
            <option value="savings_fund">Aportarlo al fondo de ahorro</option>
            <option value="available">Dejarlo disponible</option>
          </select>
        </label>
        {destination === 'goal' && <label>Meta
          <select value={goalId} onChange={(event) => setGoalId(event.target.value)}>{goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.name}</option>)}</select>
        </label>}
      </div>}

      <ErrorText value={error} />
      <div className="modal-actions finance-close-actions">
        <Button type="button" variant="ghost" onClick={onClose}>Ahora no</Button>
        <Button type="submit">Confirmar cierre</Button>
      </div>
    </form>
  </Modal>
}

function RecurringDialog({ debts = [], initial, editMode = 'period', occurrence, period, suggestedDate, presetType, accounts, categories, onClose, onOpenTemplate, onPostpone, onSkip, onToggleActive, onRevert, onSave }: {
  initial?: FinanceRecurringTransaction
  debts?: FinanceDebt[]
  editMode?: 'period' | 'template'
  occurrence?: FinanceRecurringOccurrence
  period: string
  suggestedDate: string
  presetType?: FinanceTransactionType
  accounts: FinanceAccount[]
  categories: { id: string; name: string; type: string }[]
  onClose: () => void
  onOpenTemplate?: () => void
  onPostpone?: () => void
  onSkip?: () => void
  onToggleActive?: () => void
  onRevert?: () => void
  onSave: (item: Omit<FinanceRecurringTransaction, 'createdAt' | 'updatedAt'>) => Promise<void>
}) {
  const [description, setDescription] = useState(initial?.description ?? '')
  const [amount, setAmount] = useState(String(((editMode === 'template' ? initial?.amountCents : occurrence?.amountCents) ?? initial?.amountCents ?? 0) / 100 || ''))
  const [type, setType] = useState<FinanceTransactionType>(initial?.type ?? presetType ?? 'expense')
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? '')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '')
  const [debtId, setDebtId] = useState(initial?.debtId ?? '')
  const [frequency, setFrequency] = useState<FinanceRecurringTransaction['frequency']>(initial?.frequency ?? 'monthly')
  const [date, setDate] = useState(editMode === 'template' ? initial?.nextOccurrence ?? suggestedDate : occurrence?.expectedDate ?? suggestedDate)
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
        debtId: type === 'expense' || type === 'debt_payment' ? debtId || undefined : undefined,
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar.')
    }
  }
  if (initial && editMode === 'period') {
    return <Modal open panelClassName="finance-dialog" title={`Editar ${periodLabel}`} onClose={onClose}><form className="finance-form" onSubmit={submit}>
      <label>Concepto de {periodLabel}<input value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <div className="finance-form-grid">
        <label>Importe MXN<input autoFocus required type="number" min=".01" step=".01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label>Fecha del periodo<input required type="date" min={period} max={periodEnd} value={date} onChange={(event) => setDate(event.target.value)} /></label>
      </div>
      <p className="finance-form-hint">Este monto y esta fecha sólo se aplican a {periodLabel}. Los demás meses no cambiarán.</p>
      <RecurringManagementTools item={initial} occurrence={occurrence} onOpenTemplate={onOpenTemplate} onPostpone={onPostpone} onSkip={onSkip} onToggleActive={onToggleActive} onRevert={onRevert} />
      <ErrorText value={error} /><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar periodo</Button></div>
    </form></Modal>
  }
  return <Modal open panelClassName="finance-dialog" title={initial ? 'Editar recurrencia' : 'Nuevo recurrente'} onClose={onClose}><form className="finance-form" onSubmit={submit}>
    <label>Concepto<input autoFocus required value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <div className="finance-form-grid"><label>Tipo<select value={type} onChange={(event) => { setType(event.target.value as FinanceTransactionType); setCategoryId('') }}><option value="income">Ingreso</option><option value="expense">Gasto</option><option value="saving">Ahorro</option><option value="debt_payment">Pago de deuda</option></select></label><label>Importe de {periodLabel}<input type="number" min=".01" step=".01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label></div>
    <label>Cuenta<select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>Categoría<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Selecciona</option>{categories.filter((item) => item.type === (type === 'income' ? 'income' : type === 'saving' ? 'saving' : type === 'debt_payment' ? 'debt' : 'expense')).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {(type === 'expense' || type === 'debt_payment') && <><DebtPicker debts={debts} value={debtId} onChange={setDebtId} /><p className="finance-form-hint">Los nuevos pagos de este recurrente reducirán la deuda al registrarse. Para vincular también el historial, usa Plan → Vincular.</p></>}
    <div className="finance-form-grid"><label>Frecuencia<select value={frequency} onChange={(event) => setFrequency(event.target.value as FinanceRecurringTransaction['frequency'])}><option value="weekly">Semanal</option><option value="biweekly">Quincenal</option><option value="monthly">Mensual</option><option value="quarterly">Trimestral</option><option value="yearly">Anual</option></select></label><label>{initial ? 'Próxima fecha' : `Fecha de ${periodLabel}`}<input type="date" min={initial ? undefined : period} max={initial ? undefined : periodEnd} value={date} onChange={(event) => setDate(event.target.value)} /></label></div>
    <RecurringManagementTools item={initial} occurrence={occurrence} onPostpone={onPostpone} onSkip={onSkip} onToggleActive={onToggleActive} onRevert={onRevert} />
    <ErrorText value={error} /><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar</Button></div>
  </form></Modal>
}

function RecurringManagementTools({ item, occurrence, onOpenTemplate, onPostpone, onSkip, onToggleActive, onRevert }: {
  item?: FinanceRecurringTransaction
  occurrence?: FinanceRecurringOccurrence
  onOpenTemplate?: () => void
  onPostpone?: () => void
  onSkip?: () => void
  onToggleActive?: () => void
  onRevert?: () => void
}) {
  if (!item) return null
  const paid = occurrence?.status === 'paid'
  const income = item.type === 'income' || item.type === 'refund'
  return <section className="finance-recurring-tools" aria-label="Administrar recurrencia">
    <span>Administrar recurrencia</span>
    <div>
      {onOpenTemplate && <Button type="button" variant="ghost" onClick={onOpenTemplate}>Editar programación</Button>}
      {!paid && onPostpone && <Button type="button" variant="ghost" disabled={!item.isActive} onClick={onPostpone}>Posponer periodo</Button>}
      {!paid && onSkip && <Button type="button" variant="ghost" disabled={!item.isActive} onClick={onSkip}>Omitir periodo</Button>}
      {onToggleActive && <Button type="button" variant="ghost" onClick={onToggleActive}>{item.isActive ? 'Pausar recurrencia' : 'Reanudar recurrencia'}</Button>}
      {paid && onRevert && <Button type="button" variant="ghost" onClick={onRevert}>{income ? 'Deshacer cobro' : 'Deshacer pago'}</Button>}
    </div>
  </section>
}

function GoalDialog({ initial, accounts, onClose, onSave }: { initial?: FinanceGoal; accounts: FinanceAccount[]; onClose: () => void; onSave: (item: Omit<FinanceGoal, 'createdAt' | 'updatedAt'>) => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? ''); const [date, setDate] = useState(initial?.targetDate ?? ''); const [priority, setPriority] = useState<FinanceGoal['priority']>(initial?.priority ?? 'medium'); const [accountId, setAccountId] = useState(initial?.linkedAccountId ?? ''); const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); const result = financeGoalSchema.safeParse({ name, targetAmountCents: initial?.targetAmountCents??1, targetDate: date || undefined, priority, linkedAccountId: accountId || undefined }); if (!result.success) return setError(result.error.issues[0]?.message ?? 'Revisa los campos.'); try { await onSave({ id: initial?.id ?? crypto.randomUUID(), ...result.data, description: initial?.description, status: initial?.status ?? 'active' }) } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar.') } }
  return <Modal open panelClassName="finance-dialog" title={initial ? 'Editar meta financiera' : 'Nueva meta financiera'} onClose={onClose}><form className="finance-form" onSubmit={submit}><label>Nombre<input autoFocus required value={name} onChange={(event) => setName(event.target.value)} /></label><p className="finance-form-hint">El objetivo total se calcula automáticamente con la suma de tus artículos pendientes y comprados.</p><div className="finance-form-grid"><label>Fecha objetivo<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Prioridad<select value={priority} onChange={(event) => setPriority(event.target.value as FinanceGoal['priority'])}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label></div><label>Cuenta vinculada<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Ninguna</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><ErrorText value={error} /><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar</Button></div></form></Modal>
}

function ContributionDialog({ goal, goals, accounts, onClose, onSave }: { goal?: FinanceGoal; goals: FinanceGoal[]; accounts: FinanceAccount[]; onClose: () => void; onSave: (item: { id: string; goalId: string; accountId?: string; amountCents: number; contributionDate: string; contributionSource: 'from_account' | 'previously_reserved'; description?: string; notes?: string }) => Promise<void> }) {
  const [goalId, setGoalId] = useState(goal?.id ?? goals[0]?.id ?? ''); const [source, setSource] = useState<'from_account' | 'previously_reserved'>('from_account'); const [amount, setAmount] = useState(''); const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd')); const [accountId, setAccountId] = useState(goal?.linkedAccountId ?? accounts[0]?.id ?? ''); const [description, setDescription] = useState(''); const [notes, setNotes] = useState(''); const [error, setError] = useState('')
  const selected = goals.find((item) => item.id === goalId) ?? goal
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!goalId) return setError('Selecciona una meta.'); if (moneyToCents(amount) <= 0) return setError('El importe debe ser mayor que cero.'); if (source === 'from_account' && !accountId) return setError('Selecciona una cuenta de origen.'); try { await onSave({ id: crypto.randomUUID(), goalId, accountId: source === 'from_account' ? accountId : undefined, amountCents: moneyToCents(amount), contributionDate: date, contributionSource: source, description: description || `Aportación a ${selected?.name ?? 'meta'}`, notes: notes || undefined }) } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar.') } }
  return <Modal open panelClassName="finance-dialog" title={goal ? `Aportación · ${goal.name}` : 'Nueva aportación'} onClose={onClose}><form className="finance-form" onSubmit={submit}>{!goal && <label>Meta financiera<select autoFocus required value={goalId} onChange={(event) => { const next = goals.find((item) => item.id === event.target.value); setGoalId(event.target.value); if (next?.linkedAccountId) setAccountId(next.linkedAccountId) }}><option value="">Selecciona</option>{goals.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<label>Origen de la aportación<select value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="from_account">Descontar de una cuenta y crear movimiento</option><option value="previously_reserved">Ya estaba apartado anteriormente</option></select></label><label>Importe MXN<input autoFocus={Boolean(goal)} type="number" min=".01" step=".01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label>Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>{source === 'from_account' && <><label>Cuenta origen<select required value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Selecciona</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Descripción<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={`Aportación a ${selected?.name ?? 'meta'}`} /></label></>}<label>Notas<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label><p className="finance-form-hint">Al descontar de una cuenta se creará un movimiento de ahorro vinculado. Podrás editarlo o eliminarlo desde Movimientos.</p><ErrorText value={error} /><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={!goals.length && !goal}>Registrar</Button></div></form></Modal>
}
