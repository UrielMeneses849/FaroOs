-- End a recurring schedule from a selected month without deleting its history.
-- Templates without any recorded history can still be removed completely.

create or replace function public.end_finance_recurring_schedule(
  target_recurring_id uuid,
  target_period date
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  template public.finance_recurring_transactions%rowtype;
  has_recorded_history boolean;
begin
  if target_period <> date_trunc('month', target_period)::date then
    raise exception 'Periodo inválido';
  end if;

  select * into template
  from public.finance_recurring_transactions
  where id = target_recurring_id and user_id = (select auth.uid())
  for update;

  if not found then raise exception 'Recurrente no encontrado'; end if;

  select exists (
    select 1
    from public.finance_recurring_occurrences occurrence
    where occurrence.user_id = (select auth.uid())
      and occurrence.recurring_transaction_id = template.id
      and (occurrence.period < target_period or occurrence.status = 'paid')
  ) or exists (
    select 1
    from public.finance_transactions movement
    where movement.user_id = (select auth.uid())
      and movement.recurring_transaction_id = template.id
      and movement.status = 'completed'
  ) into has_recorded_history;

  -- A schedule that has never happened is safe to remove. There is no history
  -- to preserve and its unregistered occurrences are deleted by the FK.
  if not has_recorded_history
    and date_trunc('month', template.start_date)::date >= target_period then
    delete from public.finance_recurring_transactions
    where id = template.id and user_id = (select auth.uid());
    return;
  end if;

  if target_period <= template.start_date then
    raise exception 'No se puede terminar antes del primer periodo registrado';
  end if;

  update public.finance_recurring_transactions
  set end_date = target_period - 1
  where id = template.id and user_id = (select auth.uid());

  -- Remove only unregistered future instances. Paid occurrences and their
  -- linked movements remain immutable history.
  delete from public.finance_recurring_occurrences
  where user_id = (select auth.uid())
    and recurring_transaction_id = template.id
    and period >= target_period
    and transaction_id is null
    and status <> 'paid';
end;
$$;

revoke all on function public.end_finance_recurring_schedule(uuid,date) from public;
grant execute on function public.end_finance_recurring_schedule(uuid,date) to authenticated;

notify pgrst, 'reload schema';
