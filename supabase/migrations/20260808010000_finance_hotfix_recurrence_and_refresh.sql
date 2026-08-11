-- FARO OS hot fix: make recurring period edits, registrations and reversals atomic.
-- The July period-values migration accidentally replaced the registration function
-- without advancing next_occurrence, leaving stale recurrences and projections.

create or replace function public.save_finance_recurring_period(
  target_recurring_id uuid,
  target_period date,
  target_expected_date date,
  target_amount numeric,
  target_description text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  template public.finance_recurring_transactions%rowtype;
  occurrence public.finance_recurring_occurrences%rowtype;
begin
  select * into template
  from public.finance_recurring_transactions
  where id = target_recurring_id and user_id = (select auth.uid())
  for update;

  if not found then raise exception 'Recurrente no encontrado'; end if;
  if target_period <> date_trunc('month', target_period)::date then
    raise exception 'Periodo inválido';
  end if;
  if date_trunc('month', target_expected_date)::date <> target_period then
    raise exception 'La próxima fecha debe pertenecer al periodo seleccionado';
  end if;
  if target_amount is null or target_amount <= 0 then
    raise exception 'Define un monto válido para este periodo';
  end if;

  select * into occurrence
  from public.finance_recurring_occurrences
  where user_id = (select auth.uid())
    and recurring_transaction_id = template.id
    and period = target_period
  for update;

  if found and occurrence.status = 'paid' then
    raise exception 'Deshaz el cobro o pago antes de editar este periodo';
  end if;

  if found then
    update public.finance_recurring_occurrences
    set expected_date = target_expected_date,
        amount = target_amount,
        description = nullif(trim(target_description), ''),
        -- The undo snapshot belongs to the next registration, not to an edit.
        previous_next_date = null
    where id = occurrence.id and user_id = (select auth.uid());
  else
    insert into public.finance_recurring_occurrences
      (user_id, recurring_transaction_id, period, expected_date, amount, description, previous_next_date)
    values
      ((select auth.uid()), template.id, target_period, target_expected_date, target_amount,
       nullif(trim(target_description), ''), null);
  end if;

  -- A period edit changes the upcoming occurrence only when that occurrence is
  -- still in the edited month. Historical period edits never rewrite a later plan.
  if date_trunc('month', template.next_occurrence)::date = target_period then
    update public.finance_recurring_transactions
    set next_occurrence = target_expected_date
    where id = template.id and user_id = (select auth.uid());
  end if;
end;
$$;

create or replace function public.register_finance_recurring_occurrence(
  target_recurring_id uuid,
  target_period date,
  target_expected_date date
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  template public.finance_recurring_transactions%rowtype;
  occurrence public.finance_recurring_occurrences%rowtype;
begin
  select * into template
  from public.finance_recurring_transactions
  where id = target_recurring_id and user_id = (select auth.uid())
  for update;

  if not found then raise exception 'Recurrente no encontrado'; end if;
  if target_period <> date_trunc('month', target_period)::date then
    raise exception 'Periodo inválido';
  end if;

  select * into occurrence
  from public.finance_recurring_occurrences
  where user_id = (select auth.uid())
    and recurring_transaction_id = template.id
    and period = target_period
  for update;

  if not found then raise exception 'Define el monto y la fecha de este periodo antes de registrarlo'; end if;
  if occurrence.amount is null or occurrence.amount <= 0 then raise exception 'Define un monto válido para este periodo'; end if;
  if occurrence.expected_date <> target_expected_date then raise exception 'La fecha no coincide con la configuración del periodo'; end if;
  if occurrence.status = 'paid' or occurrence.transaction_id is not null then
    raise exception 'Esta ocurrencia ya fue registrada';
  end if;

  insert into public.finance_transactions (
    id, user_id, account_id, destination_account_id, category_id, type,
    amount, transaction_date, description, status, recurring_transaction_id
  ) values (
    occurrence.id, (select auth.uid()), template.account_id, template.destination_account_id,
    template.category_id, template.type, occurrence.amount, occurrence.expected_date,
    coalesce(nullif(trim(occurrence.description), ''), template.description), 'completed', template.id
  );

  update public.finance_recurring_occurrences
  set status = 'paid', transaction_id = occurrence.id, paid_at = now(), skipped_at = null,
      previous_next_date = template.next_occurrence
  where id = occurrence.id and user_id = (select auth.uid());

  if template.next_occurrence = occurrence.expected_date then
    update public.finance_recurring_transactions
    set next_occurrence = public.finance_next_recurring_date(occurrence.expected_date, template.frequency)
    where id = template.id and user_id = (select auth.uid());
  end if;

  return occurrence.id;
end;
$$;

create or replace function public.revert_finance_recurring_occurrence(
  target_occurrence_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  occurrence public.finance_recurring_occurrences%rowtype;
begin
  select * into occurrence
  from public.finance_recurring_occurrences
  where id = target_occurrence_id and user_id = (select auth.uid())
  for update;

  if not found then raise exception 'Ocurrencia no encontrada'; end if;
  if occurrence.status <> 'paid' or occurrence.transaction_id is null then
    raise exception 'La ocurrencia no tiene un movimiento reversible';
  end if;

  update public.finance_recurring_occurrences
  set status = 'pending', transaction_id = null, paid_at = null, skipped_at = null
  where id = occurrence.id and user_id = (select auth.uid());

  delete from public.finance_transactions
  where id = occurrence.transaction_id
    and user_id = (select auth.uid())
    and recurring_transaction_id = occurrence.recurring_transaction_id;

  if not found then raise exception 'No se encontró el movimiento generado'; end if;

  if occurrence.previous_next_date is not null then
    update public.finance_recurring_transactions
    set next_occurrence = occurrence.previous_next_date
    where id = occurrence.recurring_transaction_id and user_id = (select auth.uid());
  end if;
end;
$$;

create or replace function public.delete_finance_transaction_safely(
  target_transaction_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  occurrence public.finance_recurring_occurrences%rowtype;
begin
  select * into occurrence
  from public.finance_recurring_occurrences
  where transaction_id = target_transaction_id and user_id = (select auth.uid())
  for update;

  if found then
    update public.finance_recurring_occurrences
    set status = 'pending', transaction_id = null, paid_at = null, skipped_at = null
    where id = occurrence.id and user_id = (select auth.uid());

    if occurrence.previous_next_date is not null then
      update public.finance_recurring_transactions
      set next_occurrence = occurrence.previous_next_date
      where id = occurrence.recurring_transaction_id and user_id = (select auth.uid());
    end if;
  end if;

  delete from public.finance_transactions
  where id = target_transaction_id and user_id = (select auth.uid());

  if not found then raise exception 'Movimiento no encontrado'; end if;
end;
$$;

revoke all on function public.save_finance_recurring_period(uuid,date,date,numeric,text) from public;
revoke all on function public.register_finance_recurring_occurrence(uuid,date,date) from public;
revoke all on function public.revert_finance_recurring_occurrence(uuid) from public;
revoke all on function public.delete_finance_transaction_safely(uuid) from public;
grant execute on function public.save_finance_recurring_period(uuid,date,date,numeric,text) to authenticated;
grant execute on function public.register_finance_recurring_occurrence(uuid,date,date) to authenticated;
grant execute on function public.revert_finance_recurring_occurrence(uuid) to authenticated;
grant execute on function public.delete_finance_transaction_safely(uuid) to authenticated;

notify pgrst, 'reload schema';
