-- Save the recurring occurrence, real movement and Plan funding atomically.
create function public.pay_finance_debt(
  target_id uuid,target_debt uuid,target_account uuid,target_amount numeric,target_date date,
  target_plan_amount numeric default 0,target_settlement boolean default false,
  target_principal numeric default null,target_occurrence uuid default null,target_notes text default null
) returns uuid language plpgsql set search_path='' as $$
declare
  uid uuid := (select auth.uid()); debt public.finance_debts%rowtype;
  movement public.finance_transactions%rowtype; occurrence public.finance_recurring_occurrences%rowtype;
  template public.finance_recurring_transactions%rowtype;
  category uuid; remaining numeric; movement_id uuid := target_id;
begin
  if uid is null then raise exception 'Sesión inválida'; end if;
  select * into debt from public.finance_debts where id=target_debt and user_id=uid for update;
  if not found or debt.status <> 'active' then raise exception 'Deuda no disponible para pagos'; end if;
  if target_amount is null or target_amount <= 0 or target_amount <> round(target_amount,2)
    or target_date is null or target_date < debt.balance_date or target_date > current_date then raise exception 'Revisa el monto y la fecha real del pago'; end if;
  if target_plan_amount is null or target_plan_amount < 0 or target_plan_amount > target_amount then raise exception 'Revisa el monto de Plan'; end if;
  select * into movement from public.finance_transactions where id=target_id and user_id=uid for update;
  if found and movement.status='completed' then
    if movement.debt_id=target_debt and movement.amount=target_amount and movement.transaction_date=target_date
      and movement.account_id=target_account and movement.plan_amount=target_plan_amount and movement.debt_settlement=target_settlement
      and movement.debt_principal_amount is not distinct from target_principal then return target_id; end if;
    raise exception 'Este pago ya está registrado. Puedes editarlo desde Movimientos';
  end if;
  select debt.balance-coalesce(sum(coalesce(debt_principal_amount,amount)),0) into remaining from public.finance_transactions
    where debt_id=debt.id and user_id=uid and status='completed' and transaction_date>=debt.balance_date;
  if exists(select 1 from public.finance_transactions where debt_id=debt.id and user_id=uid and status='completed' and debt_settlement and transaction_date>=debt.balance_date)
    or remaining<=0 then raise exception 'Esta deuda ya está liquidada'; end if;
  if target_principal is not null and (target_principal<0 or target_principal>target_amount) then raise exception 'Revisa el abono al saldo'; end if;
  if not target_settlement and coalesce(target_principal,target_amount)>remaining then raise exception 'El abono supera el saldo restante'; end if;
  if not exists(select 1 from public.finance_accounts where id=target_account and user_id=uid and is_active and currency='MXN') then raise exception 'Selecciona una cuenta activa en MXN'; end if;
  if target_occurrence is not null then
    select * into occurrence from public.finance_recurring_occurrences where id=target_occurrence and user_id=uid for update;
    if not found then raise exception 'Periodo recurrente no encontrado'; end if;
    select * into template from public.finance_recurring_transactions where id=occurrence.recurring_transaction_id and user_id=uid for update;
    if template.debt_id is distinct from target_debt then raise exception 'Este recurrente no está vinculado a la deuda'; end if;
    if occurrence.status='paid' then raise exception 'Este periodo ya fue pagado'; end if;
    perform public.save_finance_recurring_occurrence(occurrence.id,target_date,target_amount,null);
    movement_id := public.register_finance_recurring_occurrence(template.id,date_trunc('month',target_date)::date,target_date);
    update public.finance_transactions set account_id=target_account,debt_id=target_debt,
      debt_principal_amount=target_principal,debt_settlement=target_settlement,plan_amount=target_plan_amount,notes=target_notes
      where id=movement_id and user_id=uid;
  elsif movement.id is not null then
    if movement.debt_id is distinct from target_debt or movement.type not in ('expense','debt_payment') then raise exception 'Movimiento no vinculado a esta deuda'; end if;
    update public.finance_transactions set amount=target_amount,transaction_date=target_date,account_id=target_account,status='completed',
      debt_principal_amount=target_principal,debt_settlement=target_settlement,plan_amount=target_plan_amount,notes=target_notes
      where id=movement.id and user_id=uid;
  else
    select id into category from public.finance_categories where user_id=uid and name='Plan' and type='expense' and is_active;
    if category is null then raise exception 'Categoría Plan no encontrada'; end if;
    insert into public.finance_transactions(id,user_id,account_id,category_id,type,amount,transaction_date,description,status,debt_id,debt_principal_amount,debt_settlement,plan_amount,notes)
    values(target_id,uid,target_account,category,'expense',target_amount,target_date,
      (case when target_settlement then 'Liquidación · ' else 'Pago · ' end)||debt.name,'completed',debt.id,target_principal,target_settlement,target_plan_amount,target_notes);
  end if;
  return movement_id;
end; $$;
alter function public.link_finance_debt(uuid,uuid,uuid) rename to link_finance_debt_internal;
create function public.link_finance_debt(target_debt uuid default null,target_recurring uuid default null,target_transaction uuid default null)
returns void language sql set search_path='' as $$select public.link_finance_debt_internal(target_debt,target_recurring,target_transaction);$$;
revoke all on function public.pay_finance_debt(uuid,uuid,uuid,numeric,date,numeric,boolean,numeric,uuid,text),public.link_finance_debt(uuid,uuid,uuid) from public;
grant execute on function public.pay_finance_debt(uuid,uuid,uuid,numeric,date,numeric,boolean,numeric,uuid,text),public.link_finance_debt(uuid,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
