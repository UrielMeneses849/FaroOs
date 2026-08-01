-- Isolated AI test-lab helpers. Run these only from a dedicated Supabase Auth user.
create table if not exists public.ai_test_baselines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  captured_at timestamptz not null default now(),
  period_start date not null,
  period_end date not null,
  available_operating numeric(14,2) not null,
  real_balance numeric(14,2) not null,
  projected_balance numeric(14,2) not null,
  period_expenses numeric(14,2) not null,
  personal_budget_consumed numeric(14,2) not null
);

alter table public.ai_test_baselines enable row level security;
create policy "Users read own AI test baselines" on public.ai_test_baselines
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own AI test baselines" on public.ai_test_baselines
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users delete own AI test baselines" on public.ai_test_baselines
  for delete to authenticated using ((select auth.uid()) = user_id);
create index if not exists ai_test_baselines_user_date_idx
  on public.ai_test_baselines(user_id, captured_at desc);

create or replace function public.capture_ai_test_baseline()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  start_on date := date_trunc('month', current_date)::date;
  end_on date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  available_amount numeric(14,2);
  real_amount numeric(14,2);
  projected_amount numeric(14,2);
  expense_amount numeric(14,2);
  budget_spent numeric(14,2);
  saved public.ai_test_baselines;
begin
  if uid is null then raise exception 'Authentication required'; end if;

  select
    coalesce((select sum(a.initial_balance)
      from public.finance_accounts a
      where a.user_id = uid and a.is_active and a.type not in ('savings','investment','credit','loan')), 0)
    + coalesce((select sum(
      case when t.status = 'completed' and t.type in ('income','refund') then t.amount
           when t.status = 'completed' and t.type in ('expense','debt_payment') then -t.amount
           else 0 end)
      from public.finance_transactions t
      join public.finance_accounts a on a.id = t.account_id and a.user_id = t.user_id
      where t.user_id = uid and a.is_active and a.type not in ('savings','investment','credit','loan')), 0)
  into available_amount;

  select coalesce(sum(a.initial_balance), 0) + coalesce((
    select sum(case when t.status = 'completed' and t.type in ('income','refund') then t.amount
                    when t.status = 'completed' and t.type in ('expense','debt_payment') then -t.amount
                    else 0 end)
    from public.finance_transactions t where t.user_id = uid
  ), 0) into real_amount
  from public.finance_accounts a where a.user_id = uid and a.is_active;

  select real_amount + coalesce(sum(
    case when t.status in ('planned','pending') and t.type in ('income','refund') then t.amount
         when t.status in ('planned','pending') and t.type in ('expense','debt_payment') then -t.amount
         else 0 end), 0)
  into projected_amount
  from public.finance_transactions t
  where t.user_id = uid and t.transaction_date between start_on and end_on;

  select coalesce(sum(t.amount), 0) into expense_amount
  from public.finance_transactions t
  where t.user_id = uid and t.status = 'completed'
    and t.type in ('expense','debt_payment') and t.transaction_date between start_on and end_on;

  select coalesce(sum(t.amount), 0) into budget_spent
  from public.finance_transactions t
  join public.finance_budgets b on b.id = t.budget_id and b.user_id = t.user_id
  where t.user_id = uid and t.status = 'completed' and t.type in ('expense','debt_payment')
    and lower(b.name) like '%personal%' and t.transaction_date between b.period_start and b.period_end
    and current_date between b.period_start and b.period_end;

  insert into public.ai_test_baselines(user_id, period_start, period_end, available_operating,
    real_balance, projected_balance, period_expenses, personal_budget_consumed)
  values(uid, start_on, end_on, available_amount, real_amount, projected_amount, expense_amount, budget_spent)
  returning * into saved;

  return to_jsonb(saved);
end;
$$;

create or replace function public.prepare_ai_test_environment(
  p_nu_balance numeric default 10000,
  p_bbva_balance numeric default 15000,
  p_personal_budget numeric default 3000,
  p_confirm_is_test_user boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  personal_category_id uuid;
  period_start_on date;
  period_end_on date;
  baseline jsonb;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if not p_confirm_is_test_user then raise exception 'Confirm that this is a dedicated test user'; end if;
  if p_nu_balance < 0 or p_bbva_balance < 0 or p_personal_budget < 0 then
    raise exception 'Test amounts cannot be negative';
  end if;

  insert into public.finance_accounts(user_id, name, type, initial_balance)
  values (uid, 'NU Pruebas', 'checking', p_nu_balance), (uid, 'BBVA Pruebas', 'checking', p_bbva_balance)
  on conflict(user_id, name) do update set initial_balance = excluded.initial_balance, is_active = true;

  insert into public.finance_categories(user_id, name, type, is_default, is_active)
  values
    (uid, 'Comida', 'expense', true, true),
    (uid, 'Personal', 'expense', true, true),
    (uid, 'Transporte', 'expense', true, true),
    (uid, 'Servicios', 'expense', true, true),
    (uid, 'Sin categoría', 'expense', true, true)
  on conflict(user_id, name, type) do update set is_active = true;

  select id into personal_category_id from public.finance_categories
  where user_id = uid and name = 'Personal' and type = 'expense';
  period_start_on := case when extract(day from current_date) <= 15
    then date_trunc('month', current_date)::date else (date_trunc('month', current_date) + interval '15 days')::date end;
  period_end_on := case when extract(day from current_date) <= 15
    then (date_trunc('month', current_date) + interval '14 days')::date
    else (date_trunc('month', current_date) + interval '1 month - 1 day')::date end;

  insert into public.finance_budgets(user_id, category_id, month, planned_amount, name, period_start, period_end)
  values(uid, personal_category_id, date_trunc('month', current_date)::date, p_personal_budget,
    'Gastos Personales', period_start_on, period_end_on)
  on conflict(user_id, category_id, month) do update set
    planned_amount = excluded.planned_amount,
    name = excluded.name,
    period_start = excluded.period_start,
    period_end = excluded.period_end;

  baseline := public.capture_ai_test_baseline();
  return jsonb_build_object(
    'accounts', jsonb_build_array('NU Pruebas', 'BBVA Pruebas'),
    'categories', jsonb_build_array('Comida', 'Personal', 'Transporte', 'Servicios', 'Sin categoría'),
    'baseline', baseline
  );
end;
$$;

grant execute on function public.capture_ai_test_baseline() to authenticated;
grant execute on function public.prepare_ai_test_environment(numeric,numeric,numeric,boolean) to authenticated;
notify pgrst, 'reload schema';
