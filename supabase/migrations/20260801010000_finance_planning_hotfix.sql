-- Logical planning layers: fortnight budget, one savings fund, and goal shopping items.
alter table public.finance_budgets
  add column if not exists name text not null default 'Gastos Personales',
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists carry_over_enabled boolean not null default false;
update public.finance_budgets set period_start=coalesce(period_start,month), period_end=coalesce(period_end,(month + interval '14 days')::date);
alter table public.finance_budgets alter column period_start set not null, alter column period_end set not null;
alter table public.finance_budgets add constraint finance_budget_period_valid check(period_end>=period_start);
create unique index if not exists finance_budget_one_period_idx on public.finance_budgets(user_id,name,period_start);

alter table public.finance_transactions add column if not exists budget_id uuid;
alter table public.finance_transactions add constraint finance_transactions_budget_fk foreign key(budget_id,user_id) references public.finance_budgets(id,user_id) on delete set null (budget_id);

create table if not exists public.finance_budget_closures(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  budget_id uuid not null, leftover_amount numeric(14,2) not null check(leftover_amount>=0),
  destination text not null check(destination in('next_period','goal','savings_fund','available')),
  goal_id uuid, closed_at timestamptz not null default now(), unique(user_id,budget_id),
  foreign key(budget_id,user_id) references public.finance_budgets(id,user_id) on delete cascade,
  foreign key(goal_id,user_id) references public.finance_goals(id,user_id) on delete restrict
);

create table if not exists public.finance_savings_funds(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Fondo de Ahorro', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(user_id), unique(id,user_id)
);
create table if not exists public.finance_savings_fund_entries(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  fund_id uuid not null, amount numeric(14,2) not null check(amount<>0), entry_date date not null,
  description text, created_at timestamptz not null default now(),
  foreign key(fund_id,user_id) references public.finance_savings_funds(id,user_id) on delete cascade
);
create index if not exists finance_fund_entries_date_idx on public.finance_savings_fund_entries(user_id,entry_date desc);

create table if not exists public.finance_goal_items(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null, name text not null check(length(btrim(name)) between 1 and 140),
  price numeric(14,2) not null check(price>0), priority public.finance_goal_priority not null default 'medium',
  url text, status text not null default 'pending' check(status in('pending','purchased','discarded')),
  purchase_date date, transaction_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,user_id), foreign key(goal_id,user_id) references public.finance_goals(id,user_id) on delete cascade,
  foreign key(transaction_id,user_id) references public.finance_transactions(id,user_id) on delete set null (transaction_id)
);
create index if not exists finance_goal_items_goal_idx on public.finance_goal_items(goal_id,status);

do $$ declare t text; begin
  foreach t in array array['finance_budget_closures','finance_savings_funds','finance_savings_fund_entries','finance_goal_items'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy "Users select own %1$s" on public.%1$I for select to authenticated using ((select auth.uid())=user_id)',t);
    execute format('create policy "Users insert own %1$s" on public.%1$I for insert to authenticated with check ((select auth.uid())=user_id)',t);
    execute format('create policy "Users update own %1$s" on public.%1$I for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',t);
    execute format('create policy "Users delete own %1$s" on public.%1$I for delete to authenticated using ((select auth.uid())=user_id)',t);
  end loop;
end $$;
create trigger finance_savings_funds_updated_at before update on public.finance_savings_funds for each row execute function public.set_updated_at();
create trigger finance_goal_items_updated_at before update on public.finance_goal_items for each row execute function public.set_updated_at();

insert into public.finance_savings_funds(user_id) select id from auth.users on conflict(user_id) do nothing;
create or replace function public.seed_finance_savings_fund() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.finance_savings_funds(user_id) values(new.id) on conflict(user_id) do nothing; return new; end $$;
drop trigger if exists seed_finance_savings_fund_after_signup on auth.users;
create trigger seed_finance_savings_fund_after_signup after insert on auth.users for each row execute function public.seed_finance_savings_fund();

notify pgrst,'reload schema';
