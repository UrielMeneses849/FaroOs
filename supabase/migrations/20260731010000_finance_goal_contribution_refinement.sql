-- Keep goal-linked movements consistent and extend the default expense taxonomy.
create or replace function public.seed_finance_categories(target_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.finance_categories
    (user_id, name, type, icon, color, is_default)
  values
    (target_user_id, 'Sueldo', 'income', 'briefcase-business', '#35c78a', true),
    (target_user_id, 'Freelance', 'income', 'laptop', '#35c78a', true),
    (target_user_id, 'Ventas', 'income', 'badge-dollar-sign', '#35c78a', true),
    (target_user_id, 'Otros ingresos', 'income', 'circle-plus', '#35c78a', true),
    (target_user_id, 'Vivienda', 'expense', 'house', '#f05252', true),
    (target_user_id, 'Comida', 'expense', 'utensils', '#f4b740', true),
    (target_user_id, 'Transporte', 'expense', 'car', '#3c6cff', true),
    (target_user_id, 'Salud', 'expense', 'heart-pulse', '#35c78a', true),
    (target_user_id, 'Educación', 'expense', 'graduation-cap', '#a970ff', true),
    (target_user_id, 'Entretenimiento', 'expense', 'gamepad-2', '#f4b740', true),
    (target_user_id, 'Suscripciones', 'expense', 'repeat-2', '#3c6cff', true),
    (target_user_id, 'Compras', 'expense', 'shopping-bag', '#f05252', true),
    (target_user_id, 'Viajes', 'expense', 'plane', '#a970ff', true),
    (target_user_id, 'Impuestos', 'expense', 'landmark', '#92929a', true),
    (target_user_id, 'Préstamo', 'expense', 'hand-coins', '#e8875f', true),
    (target_user_id, 'Personal', 'expense', 'user-round', '#8b9cff', true),
    (target_user_id, 'Coppel', 'expense', 'store', '#f4b740', true),
    (target_user_id, 'Ahorro', 'saving', 'piggy-bank', '#2457ff', true),
    (target_user_id, 'Inversión', 'saving', 'chart-no-axes-combined', '#3c6cff', true),
    (target_user_id, 'Pago de deuda', 'debt', 'receipt', '#f4b740', true),
    (target_user_id, 'Transferencia', 'transfer', 'arrow-right-left', '#92929a', true)
  on conflict (user_id, name, type) do nothing;
$$;

select public.seed_finance_categories(id) from auth.users;

create or replace function public.sync_finance_goal_contribution_from_transaction()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.finance_goal_contributions
  set account_id = new.account_id,
      amount = new.amount,
      contribution_date = new.transaction_date,
      description = new.description,
      notes = new.notes
  where transaction_id = new.id and user_id = new.user_id;
  return new;
end;
$$;

drop trigger if exists sync_goal_contribution_from_transaction on public.finance_transactions;
create trigger sync_goal_contribution_from_transaction
after update of account_id, amount, transaction_date, description, notes on public.finance_transactions
for each row execute function public.sync_finance_goal_contribution_from_transaction();

create or replace function public.delete_finance_goal_contribution_with_transaction()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.finance_goal_contributions
  where transaction_id = old.id and user_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists delete_goal_contribution_with_transaction on public.finance_transactions;
create trigger delete_goal_contribution_with_transaction
before delete on public.finance_transactions
for each row execute function public.delete_finance_goal_contribution_with_transaction();
