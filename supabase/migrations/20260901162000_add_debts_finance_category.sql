-- "Deudas" is an expense category for tracking every debt-related outflow
-- together, while "Pago de deuda" remains available for the specialised
-- debt-payment movement type.
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
    (target_user_id, 'Deudas', 'expense', 'landmark', '#e8875f', true),
    (target_user_id, 'Personal', 'expense', 'user-round', '#8b9cff', true),
    (target_user_id, 'Coppel', 'expense', 'store', '#f4b740', true),
    (target_user_id, 'Ahorro', 'saving', 'piggy-bank', '#2457ff', true),
    (target_user_id, 'Inversión', 'saving', 'chart-no-axes-combined', '#3c6cff', true),
    (target_user_id, 'Pago de deuda', 'debt', 'receipt', '#f4b740', true),
    (target_user_id, 'Transferencia', 'transfer', 'arrow-right-left', '#92929a', true)
  on conflict (user_id, name, type) do nothing;
$$;

-- Backfill existing accounts immediately; the signup trigger calls the same
-- seed function for every future FARO user.
select public.seed_finance_categories(id) from auth.users;
