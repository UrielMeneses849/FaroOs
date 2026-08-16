-- Budgets are fortnightly. A month remains useful for reporting, but is not an identity.
-- This preflight intentionally changes no rows: historic data must be reviewed rather
-- than deleted or silently merged if it contains a true duplicate period.
do $$
declare
  duplicate_periods integer;
begin
  select count(*) into duplicate_periods
  from (
    select user_id, category_id, period_start, period_end
    from public.finance_budgets
    group by user_id, category_id, period_start, period_end
    having count(*) > 1
  ) as duplicate_period;

  if duplicate_periods > 0 then
    raise exception using
      errcode = '23505',
      message = format(
        'No se aplicó el hotfix de presupuestos: existen %s períodos quincenales duplicados que requieren revisión manual.',
        duplicate_periods
      );
  end if;
end
$$;

-- The original monthly key rejects the second half of the same month. The interim
-- (user_id, name, period_start) index also conflates categories and ignores period_end.
alter table public.finance_budgets
  drop constraint if exists finance_budgets_user_id_category_id_month_key;

drop index if exists public.finance_budget_one_period_idx;

alter table public.finance_budgets
  add constraint finance_budgets_user_category_period_key
  unique (user_id, category_id, period_start, period_end);

create or replace function public.close_finance_budget(
  target_budget_id uuid,
  target_destination text,
  target_goal_id uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  b public.finance_budgets;
  existing_closure public.finance_budget_closures;
  spent numeric(14,2);
  leftover numeric(14,2);
  overrun numeric(14,2);
  closure_id uuid := gen_random_uuid();
  next_budget_id uuid;
  next_start date;
  next_end date;
  carry_amount numeric(14,2);
  fund_id uuid;
begin
  if uid is null then
    raise exception 'Presupuesto no encontrado';
  end if;

  -- Locking the current budget serializes close/retry requests for this period.
  select * into b
  from public.finance_budgets
  where id = target_budget_id and user_id = uid
  for update;

  if b.id is null then
    raise exception 'Presupuesto no encontrado';
  end if;

  -- A retry returns the original closure before it can create another next budget,
  -- add carry-over twice, or create another goal/fund entry.
  select * into existing_closure
  from public.finance_budget_closures
  where user_id = uid and budget_id = b.id
  for update;

  if found then
    return existing_closure.id;
  end if;

  if b.period_end >= current_date then
    raise exception 'La quincena aún no termina';
  end if;
  if target_destination not in ('next_period', 'goal', 'savings_fund', 'available') then
    raise exception 'Destino inválido';
  end if;

  select coalesce(sum(t.amount), 0) into spent
  from public.finance_transactions t
  join public.finance_categories c on c.id = t.category_id and c.user_id = t.user_id
  where t.user_id = uid
    and t.status = 'completed'
    and t.type in ('expense', 'debt_payment')
    and t.transaction_date between b.period_start and b.period_end
    and (t.budget_id = b.id or (t.budget_id is null and c.id = b.category_id and c.name = 'Personal'));

  leftover := greatest(b.planned_amount - spent, 0);
  overrun := greatest(spent - b.planned_amount, 0);
  carry_amount := case when target_destination = 'next_period' then leftover else 0 end;
  next_start := b.period_end + 1;
  next_end := case
    when extract(day from next_start) = 1 then next_start + 14
    else (date_trunc('month', next_start) + interval '1 month - 1 day')::date
  end;

  -- The period key permits Aug 1-15 and Aug 16-31 for the same category. If the
  -- next period was defined before closing, preserve its chosen amount and add only
  -- the new carry-over exactly once (the closure guard above handles retries).
  insert into public.finance_budgets(
    user_id, category_id, month, planned_amount, name,
    period_start, period_end, carry_over_enabled
  ) values (
    uid, b.category_id, date_trunc('month', next_start)::date,
    b.planned_amount + carry_amount, b.name, next_start, next_end, carry_amount > 0
  )
  on conflict (user_id, category_id, period_start, period_end) do update
    set planned_amount = case
          when carry_amount > 0 then public.finance_budgets.planned_amount + carry_amount
          else public.finance_budgets.planned_amount
        end,
        carry_over_enabled = case
          when carry_amount > 0 then true
          else public.finance_budgets.carry_over_enabled
        end,
        updated_at = now()
  returning id into next_budget_id;

  if leftover > 0 and target_destination = 'goal' then
    if target_goal_id is null then
      raise exception 'Selecciona una meta';
    end if;
    insert into public.finance_goal_contributions(
      user_id, goal_id, amount, contribution_date, contribution_source, description
    ) values (
      uid, target_goal_id, leftover, current_date,
      'previously_reserved', 'Sobrante de presupuesto'
    );
  elsif leftover > 0 and target_destination = 'savings_fund' then
    select id into fund_id from public.finance_savings_funds where user_id = uid;
    insert into public.finance_savings_fund_entries(user_id, fund_id, amount, entry_date, description)
    values (uid, fund_id, leftover, current_date, 'Sobrante de presupuesto');
  end if;

  insert into public.finance_budget_closures(
    id, user_id, budget_id, leftover_amount, spent_amount, overrun_amount,
    destination, goal_id, next_budget_id
  ) values (
    closure_id, uid, b.id, leftover, spent, overrun,
    case when overrun > 0 then 'available' else target_destination end,
    case when leftover > 0 and target_destination = 'goal' then target_goal_id else null end,
    next_budget_id
  );

  return closure_id;
end
$$;

-- FARO Lab seeds the same finance domain. Keep it on the exact production period key
-- rather than retaining a monthly-only code path.
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
  on conflict(user_id, category_id, period_start, period_end) do update set
    planned_amount = excluded.planned_amount,
    name = excluded.name;

  baseline := public.capture_ai_test_baseline();
  return jsonb_build_object(
    'accounts', jsonb_build_array('NU Pruebas', 'BBVA Pruebas'),
    'categories', jsonb_build_array('Comida', 'Personal', 'Transporte', 'Servicios', 'Sin categoría'),
    'baseline', baseline
  );
end;
$$;

revoke all on function public.close_finance_budget(uuid, text, uuid) from public;
grant execute on function public.close_finance_budget(uuid, text, uuid) to authenticated;
grant execute on function public.prepare_ai_test_environment(numeric, numeric, numeric, boolean) to authenticated;

notify pgrst, 'reload schema';
