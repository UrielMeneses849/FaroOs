-- Atomic recurring execution and reversal. Additive and history-safe.

alter table public.finance_recurring_occurrences
  add column if not exists previous_next_date date;

create or replace function public.finance_next_recurring_date(
  current_date_value date,
  frequency_value public.finance_frequency
)
returns date
language sql
immutable
set search_path = ''
as $$
  select case frequency_value
    when 'weekly' then current_date_value + 7
    when 'biweekly' then current_date_value + 14
    when 'monthly' then (current_date_value + interval '1 month')::date
    when 'quarterly' then (current_date_value + interval '3 months')::date
    when 'yearly' then (current_date_value + interval '1 year')::date
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

  insert into public.finance_recurring_occurrences
    (user_id, recurring_transaction_id, period, expected_date, previous_next_date)
  values
    ((select auth.uid()), template.id, target_period, target_expected_date, template.next_occurrence)
  on conflict (user_id, recurring_transaction_id, period) do nothing;

  select * into occurrence
  from public.finance_recurring_occurrences
  where user_id = (select auth.uid())
    and recurring_transaction_id = template.id
    and period = target_period
  for update;

  if occurrence.status = 'paid' or occurrence.transaction_id is not null then
    raise exception 'Esta ocurrencia ya fue registrada';
  end if;

  insert into public.finance_transactions (
    id, user_id, account_id, destination_account_id, category_id, type,
    amount, transaction_date, description, status, recurring_transaction_id
  ) values (
    occurrence.id, (select auth.uid()), template.account_id,
    template.destination_account_id, template.category_id, template.type,
    template.amount, target_expected_date, template.description, 'completed', template.id
  );

  update public.finance_recurring_occurrences
  set status = 'paid', transaction_id = occurrence.id, paid_at = now(),
      skipped_at = null,
      previous_next_date = coalesce(previous_next_date, template.next_occurrence)
  where id = occurrence.id and user_id = (select auth.uid());

  update public.finance_recurring_transactions
  set next_occurrence = public.finance_next_recurring_date(target_expected_date, template.frequency)
  where id = template.id and user_id = (select auth.uid());

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

  if not found then
    raise exception 'No se encontró el movimiento generado';
  end if;

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

revoke all on function public.register_finance_recurring_occurrence(uuid,date,date) from public;
revoke all on function public.revert_finance_recurring_occurrence(uuid) from public;
revoke all on function public.delete_finance_transaction_safely(uuid) from public;
grant execute on function public.register_finance_recurring_occurrence(uuid,date,date) to authenticated;
grant execute on function public.revert_finance_recurring_occurrence(uuid) to authenticated;
grant execute on function public.delete_finance_transaction_safely(uuid) to authenticated;

notify pgrst, 'reload schema';
