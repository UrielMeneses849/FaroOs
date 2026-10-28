-- Keep creditor balance corrections and refreshed payoff quotes on the payment.
-- Cancelling/deleting the payment also removes its correction and quote.
alter table public.finance_transactions
  add column debt_balance_adjustment numeric(14,2) not null default 0,
  add column debt_quote numeric(14,2) check (debt_quote > 0),
  add column debt_quote_valid_until date,
  add check (debt_quote_valid_until is null or (debt_quote is not null and debt_quote_valid_until >= transaction_date));

drop function public.pay_finance_debt(uuid,uuid,uuid,numeric,date,numeric,boolean,numeric,uuid,text);
create or replace function public.validate_finance_debt_remaining() returns trigger
language plpgsql set search_path='' as $$
declare debt public.finance_debts%rowtype; remaining numeric; agreement_remaining numeric;
begin
  if new.debt_id is null then
    new.debt_balance_adjustment:=0; new.debt_quote:=null; new.debt_quote_valid_until:=null;
    return new;
  end if;
  if new.status <> 'completed' then return new; end if;
  select * into debt from public.finance_debts where id=new.debt_id and user_id=new.user_id for update;
  if not found then raise exception 'Deuda no encontrada'; end if;
  -- Historical payments may be linked for context; the snapshot already includes them.
  if new.transaction_date < debt.balance_date then return new; end if;
  select debt.balance-coalesce(sum(coalesce(debt_principal_amount,amount)-debt_balance_adjustment),0) into remaining
    from public.finance_transactions where debt_id=debt.id and user_id=new.user_id and status='completed' and transaction_date>=debt.balance_date and id<>new.id;
  if debt.agreement_status='confirmed' and new.transaction_date>=debt.agreement_start_date then
    select debt.agreement_amount-coalesce(sum(coalesce(debt_principal_amount,amount)-debt_balance_adjustment),0) into agreement_remaining
      from public.finance_transactions where debt_id=debt.id and user_id=new.user_id and status='completed' and transaction_date>=greatest(debt.balance_date,debt.agreement_start_date) and id<>new.id;
    remaining:=least(remaining,agreement_remaining);
  end if;
  if not new.debt_settlement and coalesce(new.debt_principal_amount,new.amount)>greatest(0,remaining+new.debt_balance_adjustment) then raise exception 'El abono supera el saldo restante de la deuda'; end if;
  return new;
end; $$;
-- Save the recurring occurrence, real movement and Plan funding atomically.
create function public.pay_finance_debt(
  target_id uuid,target_debt uuid,target_account uuid,target_amount numeric,target_date date,
  target_plan_amount numeric default 0,target_settlement boolean default false,
  target_principal numeric default null,target_occurrence uuid default null,target_notes text default null,
  target_balance_adjustment numeric default 0,target_quote numeric default null,target_quote_valid_until date default null
) returns uuid language plpgsql set search_path='' as $$
declare
  uid uuid := (select auth.uid()); debt public.finance_debts%rowtype;
  movement public.finance_transactions%rowtype; occurrence public.finance_recurring_occurrences%rowtype;
  template public.finance_recurring_transactions%rowtype;
  category uuid; remaining numeric; agreement_remaining numeric; movement_id uuid := target_id;
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
      and movement.debt_principal_amount is not distinct from target_principal and movement.debt_balance_adjustment=target_balance_adjustment
      and movement.debt_quote is not distinct from target_quote
      and movement.debt_quote_valid_until is not distinct from target_quote_valid_until then return target_id; end if;
    raise exception 'Este pago ya está registrado. Puedes editarlo desde Movimientos';
  end if;
  select debt.balance-coalesce(sum(coalesce(debt_principal_amount,amount)-debt_balance_adjustment),0) into remaining from public.finance_transactions
    where debt_id=debt.id and user_id=uid and status='completed' and transaction_date>=debt.balance_date;
  if debt.agreement_status='confirmed' and target_date>=debt.agreement_start_date then
    select debt.agreement_amount-coalesce(sum(coalesce(debt_principal_amount,amount)-debt_balance_adjustment),0) into agreement_remaining
      from public.finance_transactions where debt_id=debt.id and user_id=uid and status='completed' and transaction_date>=greatest(debt.balance_date,debt.agreement_start_date);
    remaining:=least(remaining,agreement_remaining);
  end if;
  if exists(select 1 from public.finance_transactions where debt_id=debt.id and user_id=uid and status='completed' and debt_settlement and transaction_date>=debt.balance_date)
    or remaining<=0 then raise exception 'Esta deuda ya está liquidada'; end if;
  if target_balance_adjustment is null or target_balance_adjustment<>round(target_balance_adjustment,2)
    or remaining+target_balance_adjustment-coalesce(target_principal,target_amount)<0 and not target_settlement then raise exception 'Saldo actualizado inválido'; end if;
  if (target_balance_adjustment<>0 or target_quote is not null) and exists(
    select 1 from public.finance_transactions where debt_id=debt.id and user_id=uid and status='completed' and transaction_date>target_date
  ) then raise exception 'Actualiza las cifras en el pago más reciente de la deuda'; end if;
  if target_settlement and (target_balance_adjustment<>0 or target_quote is not null) then raise exception 'Una liquidación debe dejar el saldo en cero'; end if;
  if target_principal is not null and (target_principal<0 or target_principal>target_amount) then raise exception 'Revisa el abono al saldo'; end if;
  if not target_settlement and coalesce(target_principal,target_amount)>remaining+target_balance_adjustment then raise exception 'El abono supera el saldo restante'; end if;
  if not exists(select 1 from public.finance_accounts where id=target_account and user_id=uid and is_active and currency='MXN') then raise exception 'Selecciona una cuenta activa en MXN'; end if;
  if target_occurrence is not null then
    select * into occurrence from public.finance_recurring_occurrences where id=target_occurrence and user_id=uid for update;
    if not found then raise exception 'Periodo recurrente no encontrado'; end if;
    select * into template from public.finance_recurring_transactions where id=occurrence.recurring_transaction_id and user_id=uid for update;
    if template.debt_id is distinct from target_debt then raise exception 'Este recurrente no está vinculado a la deuda'; end if;
    if occurrence.status='paid' then raise exception 'Este periodo ya fue pagado'; end if;
    -- Registration first inherits the link with a nominal principal. Cap its
    -- temporary amount; the final write below applies the actual amount,
    -- capital, correction and settlement together in this same transaction.
    perform public.save_finance_recurring_occurrence(occurrence.id,target_date,least(target_amount,remaining),null);
    movement_id := public.register_finance_recurring_occurrence(template.id,date_trunc('month',target_date)::date,target_date);
    update public.finance_transactions set amount=target_amount,account_id=target_account,debt_id=target_debt,
      debt_balance_adjustment=target_balance_adjustment,debt_quote=target_quote,debt_quote_valid_until=target_quote_valid_until,
      debt_principal_amount=target_principal,debt_settlement=target_settlement,plan_amount=target_plan_amount,notes=target_notes
      where id=movement_id and user_id=uid;
    update public.finance_recurring_occurrences set amount=target_amount where id=occurrence.id and user_id=uid;
  elsif movement.id is not null then
    if movement.debt_id is distinct from target_debt or movement.type not in ('expense','debt_payment') then raise exception 'Movimiento no vinculado a esta deuda'; end if;
    update public.finance_transactions set amount=target_amount,transaction_date=target_date,account_id=target_account,status='completed',
      debt_balance_adjustment=target_balance_adjustment,debt_quote=target_quote,debt_quote_valid_until=target_quote_valid_until,
      debt_principal_amount=target_principal,debt_settlement=target_settlement,plan_amount=target_plan_amount,notes=target_notes
      where id=movement.id and user_id=uid;
  else
    select id into category from public.finance_categories where user_id=uid and name='Plan' and type='expense' and is_active;
    if category is null then raise exception 'Categoría Plan no encontrada'; end if;
    insert into public.finance_transactions(id,user_id,account_id,category_id,type,amount,transaction_date,description,status,debt_id,debt_principal_amount,debt_settlement,plan_amount,notes,debt_balance_adjustment,debt_quote,debt_quote_valid_until)
    values(target_id,uid,target_account,category,'expense',target_amount,target_date,
      (case when target_settlement then 'Liquidación · ' else 'Pago · ' end)||debt.name,'completed',debt.id,target_principal,target_settlement,target_plan_amount,target_notes,target_balance_adjustment,target_quote,target_quote_valid_until);
  end if;
  return movement_id;
end; $$;

revoke all on function public.pay_finance_debt(uuid,uuid,uuid,numeric,date,numeric,boolean,numeric,uuid,text,numeric,numeric,date) from public;
grant execute on function public.pay_finance_debt(uuid,uuid,uuid,numeric,date,numeric,boolean,numeric,uuid,text,numeric,numeric,date) to authenticated;
notify pgrst,'reload schema';
