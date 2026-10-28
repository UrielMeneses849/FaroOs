-- Payments before a negotiated agreement must not reduce its newly agreed total.
alter table public.finance_debts add column agreement_start_date date;
update public.finance_debts set agreement_start_date=balance_date where agreement_status <> 'none';
alter table public.finance_debts add check (agreement_status='none' or agreement_start_date is not null);

create function public.validate_finance_debt_remaining() returns trigger
language plpgsql set search_path='' as $$
declare debt public.finance_debts%rowtype; remaining numeric; agreement_remaining numeric;
begin
  if new.debt_id is null or new.status <> 'completed' then return new; end if;
  select * into debt from public.finance_debts where id=new.debt_id and user_id=new.user_id for update;
  if not found then raise exception 'Deuda no encontrada'; end if;
  -- Historical payments may be linked for context; the snapshot already includes them.
  if new.transaction_date < debt.balance_date then return new; end if;
  select debt.balance-coalesce(sum(coalesce(debt_principal_amount,amount)),0) into remaining
    from public.finance_transactions where debt_id=debt.id and user_id=new.user_id and status='completed' and transaction_date>=debt.balance_date and id<>new.id;
  if debt.agreement_status='confirmed' and new.transaction_date>=debt.agreement_start_date then
    select debt.agreement_amount-coalesce(sum(coalesce(debt_principal_amount,amount)),0) into agreement_remaining
      from public.finance_transactions where debt_id=debt.id and user_id=new.user_id and status='completed' and transaction_date>=greatest(debt.balance_date,debt.agreement_start_date) and id<>new.id;
    remaining:=least(remaining,agreement_remaining);
  end if;
  if not new.debt_settlement and coalesce(new.debt_principal_amount,new.amount)>greatest(0,remaining) then raise exception 'El abono supera el saldo restante de la deuda'; end if;
  return new;
end; $$;
-- It runs after the inherited recurring link has been assigned (alphabetical order).
create trigger finance_debt_remaining_validation before insert or update on public.finance_transactions for each row execute function public.validate_finance_debt_remaining();
revoke all on function public.validate_finance_debt_remaining() from public;
notify pgrst,'reload schema';
