-- FARO OS Finance: additive schema. Existing public.transactions remains untouched.

create type public.finance_account_type as enum
  ('cash', 'checking', 'savings', 'credit', 'investment', 'loan');
create type public.finance_category_type as enum
  ('income', 'expense', 'saving', 'debt', 'transfer');
create type public.finance_transaction_type as enum
  ('income', 'expense', 'transfer', 'saving', 'debt_payment', 'refund');
create type public.finance_transaction_status as enum
  ('planned', 'pending', 'completed', 'cancelled');
create type public.finance_frequency as enum
  ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly');
create type public.finance_goal_status as enum
  ('active', 'paused', 'completed', 'cancelled');
create type public.finance_goal_priority as enum
  ('low', 'medium', 'high', 'critical');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  type public.finance_account_type not null,
  currency char(3) not null default 'MXN',
  initial_balance numeric(14,2) not null default 0,
  credit_limit numeric(14,2) check (credit_limit is null or credit_limit >= 0),
  closing_day smallint check (closing_day is null or closing_day between 1 and 31),
  payment_day smallint check (payment_day is null or payment_day between 1 and 31),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, name)
);

create table public.finance_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  type public.finance_category_type not null,
  icon text,
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, name, type)
);

create table public.finance_recurring_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  destination_account_id uuid,
  category_id uuid,
  type public.finance_transaction_type not null,
  amount numeric(14,2) not null check (amount > 0),
  description text not null check (length(btrim(description)) between 1 and 160),
  frequency public.finance_frequency not null,
  start_date date not null,
  next_occurrence date not null,
  end_date date,
  day_of_month smallint check (day_of_month is null or day_of_month between 1 and 31),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (account_id, user_id)
    references public.finance_accounts(id, user_id) on delete restrict,
  foreign key (destination_account_id, user_id)
    references public.finance_accounts(id, user_id) on delete restrict,
  foreign key (category_id, user_id)
    references public.finance_categories(id, user_id) on delete restrict,
  check (end_date is null or end_date >= start_date),
  check (
    (type = 'transfer' and destination_account_id is not null and destination_account_id <> account_id)
    or (type <> 'transfer' and destination_account_id is null)
  ),
  check (category_id is not null or type = 'transfer')
);

create table public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  destination_account_id uuid,
  category_id uuid,
  type public.finance_transaction_type not null,
  amount numeric(14,2) not null check (amount > 0),
  transaction_date date not null,
  description text not null check (length(btrim(description)) between 1 and 160),
  status public.finance_transaction_status not null default 'completed',
  notes text,
  recurring_transaction_id uuid,
  legacy_transaction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, legacy_transaction_id),
  foreign key (account_id, user_id)
    references public.finance_accounts(id, user_id) on delete restrict,
  foreign key (destination_account_id, user_id)
    references public.finance_accounts(id, user_id) on delete restrict,
  foreign key (category_id, user_id)
    references public.finance_categories(id, user_id) on delete restrict,
  foreign key (recurring_transaction_id, user_id)
    references public.finance_recurring_transactions(id, user_id)
    on delete set null (recurring_transaction_id),
  check (
    (type = 'transfer' and destination_account_id is not null and destination_account_id <> account_id)
    or (type <> 'transfer' and destination_account_id is null)
  ),
  check (category_id is not null or type = 'transfer')
);

create table public.finance_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null,
  month date not null check (extract(day from month) = 1),
  planned_amount numeric(14,2) not null check (planned_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, category_id, month),
  foreign key (category_id, user_id)
    references public.finance_categories(id, user_id) on delete restrict
);

create table public.finance_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  description text,
  target_amount numeric(14,2) not null check (target_amount > 0),
  target_date date,
  status public.finance_goal_status not null default 'active',
  priority public.finance_goal_priority not null default 'medium',
  linked_account_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (linked_account_id, user_id)
    references public.finance_accounts(id, user_id) on delete restrict
);

create table public.finance_goal_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null,
  account_id uuid,
  amount numeric(14,2) not null check (amount > 0),
  contribution_date date not null,
  notes text,
  transaction_id uuid,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, transaction_id),
  foreign key (goal_id, user_id)
    references public.finance_goals(id, user_id) on delete cascade,
  foreign key (account_id, user_id)
    references public.finance_accounts(id, user_id) on delete restrict,
  foreign key (transaction_id, user_id)
    references public.finance_transactions(id, user_id)
    on delete set null (transaction_id)
);

create index finance_accounts_user_idx on public.finance_accounts(user_id);
create index finance_categories_user_type_idx on public.finance_categories(user_id, type);
create index finance_transactions_user_date_idx on public.finance_transactions(user_id, transaction_date desc);
create index finance_transactions_account_idx on public.finance_transactions(account_id);
create index finance_transactions_category_idx on public.finance_transactions(category_id);
create index finance_recurring_user_next_idx on public.finance_recurring_transactions(user_id, next_occurrence);
create index finance_budgets_user_month_idx on public.finance_budgets(user_id, month);
create index finance_goals_user_status_idx on public.finance_goals(user_id, status);
create index finance_contributions_goal_idx on public.finance_goal_contributions(goal_id, contribution_date);

create trigger finance_accounts_updated_at before update on public.finance_accounts
for each row execute function public.set_updated_at();
create trigger finance_categories_updated_at before update on public.finance_categories
for each row execute function public.set_updated_at();
create trigger finance_transactions_updated_at before update on public.finance_transactions
for each row execute function public.set_updated_at();
create trigger finance_recurring_updated_at before update on public.finance_recurring_transactions
for each row execute function public.set_updated_at();
create trigger finance_budgets_updated_at before update on public.finance_budgets
for each row execute function public.set_updated_at();
create trigger finance_goals_updated_at before update on public.finance_goals
for each row execute function public.set_updated_at();

alter table public.finance_accounts enable row level security;
alter table public.finance_categories enable row level security;
alter table public.finance_transactions enable row level security;
alter table public.finance_recurring_transactions enable row level security;
alter table public.finance_budgets enable row level security;
alter table public.finance_goals enable row level security;
alter table public.finance_goal_contributions enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'finance_accounts', 'finance_categories', 'finance_transactions',
    'finance_recurring_transactions', 'finance_budgets',
    'finance_goals', 'finance_goal_contributions'
  ]
  loop
    execute format(
      'create policy "Users select own %1$s" on public.%1$I for select to authenticated using ((select auth.uid()) = user_id)',
      table_name
    );
    execute format(
      'create policy "Users insert own %1$s" on public.%1$I for insert to authenticated with check ((select auth.uid()) = user_id)',
      table_name
    );
    execute format(
      'create policy "Users update own %1$s" on public.%1$I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name
    );
    execute format(
      'create policy "Users delete own %1$s" on public.%1$I for delete to authenticated using ((select auth.uid()) = user_id)',
      table_name
    );
  end loop;
end;
$$;

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
    (target_user_id, 'Ahorro', 'saving', 'piggy-bank', '#2457ff', true),
    (target_user_id, 'Inversión', 'saving', 'chart-no-axes-combined', '#3c6cff', true),
    (target_user_id, 'Pago de deuda', 'debt', 'receipt', '#f4b740', true),
    (target_user_id, 'Transferencia', 'transfer', 'arrow-right-left', '#92929a', true)
  on conflict (user_id, name, type) do nothing;
$$;

create or replace function public.seed_finance_categories_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_finance_categories(new.id);
  return new;
end;
$$;

create trigger seed_finance_categories_after_signup
after insert on auth.users
for each row execute function public.seed_finance_categories_for_new_user();

select public.seed_finance_categories(id) from auth.users;

revoke all on function public.seed_finance_categories(uuid) from public;
