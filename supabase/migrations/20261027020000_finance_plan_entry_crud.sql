-- Correct or delete a reserve without changing accounts or invalidating paid debt.
create or replace function public.revise_finance_debt_plan_entry(
  target_id uuid,
  target_amount numeric default null,
  target_date date default null,
  target_notes text default null,
  target_remove boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  entry_account uuid;
  old_amount numeric;
  next_amount numeric;
  difference numeric;
  plan_available numeric;
  account_cash numeric;
  account_active boolean;
  account_currency text;
begin
  if uid is null then raise exception 'Sesión inválida'; end if;
  if not coalesce(target_remove, false) and (
    target_amount is null or target_amount = 0 or target_amount <> round(target_amount, 2)
    or target_date is null or target_date > current_date
  ) then raise exception 'Revisa el monto y la fecha de la reserva'; end if;

  -- Same per-user lock as allocation and completed payments.
  insert into public.finance_debt_plan_preferences(user_id) values(uid) on conflict do nothing;
  perform 1 from public.finance_debt_plan_preferences where user_id = uid for update;
  select account_id into entry_account from public.finance_debt_plan_entries where id = target_id and user_id = uid;
  if not found then raise exception 'No se encontró la reserva en tu cuenta'; end if;
  select initial_balance, is_active, currency into account_cash, account_active, account_currency
    from public.finance_accounts where id = entry_account and user_id = uid for update;
  if not found then raise exception 'No se encontró la cuenta de la reserva'; end if;
  select amount into old_amount from public.finance_debt_plan_entries where id = target_id and user_id = uid for update;
  next_amount := case when coalesce(target_remove, false) then 0 else target_amount end;
  difference := next_amount - old_amount;

  select coalesce(sum(amount), 0) into plan_available from public.finance_debt_plan_entries where user_id = uid and account_id = entry_account;
  select plan_available - coalesce(sum(plan_amount), 0) into plan_available from public.finance_transactions
    where user_id = uid and account_id = entry_account and status = 'completed';
  if plan_available + difference < 0 then raise exception 'Parte de esta reserva ya se utilizó. Corrige primero los pagos para no dejar Plan sin saldo'; end if;
  select account_cash + coalesce(sum(case
    when type in ('income', 'refund') and account_id = entry_account then amount
    when type = 'transfer' and destination_account_id = entry_account then amount
    when type in ('expense', 'debt_payment', 'saving', 'transfer') and account_id = entry_account then -amount
    else 0 end), 0) into account_cash from public.finance_transactions where user_id = uid and status = 'completed';
  if difference > 0 and (not account_active or account_currency <> 'MXN') then raise exception 'Selecciona una cuenta activa en MXN para aumentar la reserva'; end if;
  if difference > 0 and difference > account_cash - plan_available then raise exception 'La cuenta no tiene disponible suficiente para ese cambio'; end if;

  if coalesce(target_remove, false) then
    delete from public.finance_debt_plan_entries where id = target_id and user_id = uid;
  else
    update public.finance_debt_plan_entries set amount = target_amount, entry_date = target_date, notes = nullif(btrim(target_notes), '')
      where id = target_id and user_id = uid;
  end if;
end;
$$;
revoke all on function public.revise_finance_debt_plan_entry(uuid,numeric,date,text,boolean) from public, anon;
grant execute on function public.revise_finance_debt_plan_entry(uuid,numeric,date,text,boolean) to authenticated;
notify pgrst, 'reload schema';
