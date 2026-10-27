import type { FinanceDebt } from './debtTypes'
import type { FinanceData } from './financeTypes'
import { debtPlanBalanceCents } from '../../services/debtPlanBalance'
import { formatMxn } from '../../services/financeService'

export function DebtPicker({ debts, value, onChange }: { debts: FinanceDebt[]; value: string; onChange: (value: string) => void }) {
  return <label>Vinculación a deuda <span>opcional</span><select value={value} onChange={event => onChange(event.target.value)}><option value="">Sin deuda vinculada</option>{debts.filter(debt => debt.status !== 'archived' || debt.id === value).map(debt => <option key={debt.id} value={debt.id}>{debt.name}</option>)}</select></label>
}

export function DebtMovementFields({ data, debtId, accountId, onDebt, planAmount, onPlanAmount, principal, onPrincipal, settlement, onSettlement }: {
  data: FinanceData; debtId: string; accountId: string; onDebt: (value: string) => void;
  planAmount: string; onPlanAmount: (value: string) => void; principal: string; onPrincipal: (value: string) => void;
  settlement: boolean; onSettlement: (value: boolean) => void
}) {
  return <><DebtPicker debts={data.debtPlan?.debts ?? []} value={debtId} onChange={onDebt} />{debtId && <>
    <div className="finance-form-grid"><label>Usar de Plan MXN<input type="number" min="0" step=".01" value={planAmount} onChange={event => onPlanAmount(event.target.value)} /></label><label>Abono al saldo MXN <span>opcional</span><input type="number" min="0" step=".01" value={principal} onChange={event => onPrincipal(event.target.value)} /></label></div>
    <p className="finance-form-hint">Plan en esta cuenta: {formatMxn(debtPlanBalanceCents(data, accountId))}. Sin abono indicado, todo el pago reduce el saldo. Sólo cuenta al marcarlo completado.</p>
    <label className="dp-check"><input style={{ width: 16, minHeight: 16 }} type="checkbox" checked={settlement} onChange={event => onSettlement(event.target.checked)} />El acreedor confirmó que este pago liquida la deuda.</label>
  </>}</>
}
