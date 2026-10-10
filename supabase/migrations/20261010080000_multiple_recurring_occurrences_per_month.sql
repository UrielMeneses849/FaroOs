-- Weekly and biweekly schedules can have more than one occurrence in a month.

alter table public.finance_recurring_occurrences
  drop constraint if exists finance_recurring_occurrences_user_id_recurring_transaction_id_period_key;

alter table public.finance_recurring_occurrences
  add constraint finance_recurring_occurrences_user_recurring_date_key
  unique (user_id, recurring_transaction_id, expected_date);

create or replace function public.save_finance_recurring_occurrence(
  target_occurrence_id uuid,
  target_expected_date date,
  target_amount numeric,
  target_description text default null
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
  if occurrence.status = 'paid' then raise exception 'Deshaz el pago antes de editarlo'; end if;
  if target_amount is null or target_amount <= 0 then raise exception 'Define un monto válido'; end if;

  update public.finance_recurring_occurrences
  set period = date_trunc('month', target_expected_date)::date,
      expected_date = target_expected_date,
      amount = target_amount,
      description = nullif(trim(target_description), ''),
      previous_next_date = null
  where id = occurrence.id and user_id = (select auth.uid());
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
  if target_period <> date_trunc('month', target_period)::date
    or target_period <> date_trunc('month', target_expected_date)::date then
    raise exception 'Periodo inválido';
  end if;

  select * into occurrence
  from public.finance_recurring_occurrences
  where user_id = (select auth.uid())
    and recurring_transaction_id = template.id
    and expected_date = target_expected_date
  for update;

  if not found then raise exception 'No se encontró el pago recurrente de esta fecha'; end if;
  if occurrence.amount is null or occurrence.amount <= 0 then raise exception 'Define un monto válido'; end if;
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

revoke all on function public.save_finance_recurring_occurrence(uuid,date,numeric,text) from public;
grant execute on function public.save_finance_recurring_occurrence(uuid,date,numeric,text) to authenticated;

notify pgrst, 'reload schema';
