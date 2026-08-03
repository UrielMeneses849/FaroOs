alter table public.finance_recurring_occurrences
  add column if not exists description text;

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
  select * into template from public.finance_recurring_transactions
  where id = target_recurring_id and user_id = (select auth.uid()) for update;
  if not found then raise exception 'Recurrente no encontrado'; end if;
  if target_period <> date_trunc('month', target_period)::date then raise exception 'Periodo inválido'; end if;

  select * into occurrence from public.finance_recurring_occurrences
  where user_id = (select auth.uid()) and recurring_transaction_id = template.id and period = target_period
  for update;
  if not found then raise exception 'Define el monto y la fecha de este periodo antes de registrarlo'; end if;
  if occurrence.amount is null or occurrence.amount <= 0 then raise exception 'Define un monto válido para este periodo'; end if;
  if occurrence.expected_date <> target_expected_date then raise exception 'La fecha no coincide con la configuración del periodo'; end if;
  if occurrence.status = 'paid' or occurrence.transaction_id is not null then raise exception 'Esta ocurrencia ya fue registrada'; end if;

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
      previous_next_date = coalesce(previous_next_date, template.next_occurrence)
  where id = occurrence.id and user_id = (select auth.uid());
  return occurrence.id;
end;
$$;

revoke all on function public.register_finance_recurring_occurrence(uuid,date,date) from public;
grant execute on function public.register_finance_recurring_occurrence(uuid,date,date) to authenticated;
