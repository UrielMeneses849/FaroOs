-- Plan is a reserved envelope, never a second expense. Actual payments remain
-- ordinary financial transactions so edits/reverts restore both debt and funds.
create table public.finance_debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  creditor text not null default '',
  kind text not null check (kind in ('purchase','loan','negotiable')),
  status text not null default 'active' check (status in ('active','paused','archived')),
  balance numeric(14,2) not null check (balance > 0),
  balance_date date not null,
  payment numeric(14,2) not null check (payment > 0),
  frequency public.finance_frequency not null default 'monthly',
  next_payment_date date not null,
  deadline date,
  settlement numeric(14,2) check (settlement > 0 and settlement <= balance),
  quote_date date,
  quote_valid_until date,
  agreement_amount numeric(14,2) check (agreement_amount > 0 and agreement_amount <= balance),
  agreement_payments integer check (agreement_payments between 1 and 120),
  agreement_status text not null default 'none' check (agreement_status in ('none','proposed','confirmed')),
  priority integer not null default 0 check (priority between 0 and 999),
  notes text check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,user_id),
  check (agreement_status = 'none' or (agreement_amount is not null and agreement_payments is not null)),
  check (settlement is null or quote_date is not null),
  check (quote_valid_until is null or quote_valid_until >= quote_date)
);
create table public.finance_debt_plan_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_contribution numeric(14,2) not null default 0 check (monthly_contribution >= 0),
  contribution_day integer not null default 15 check (contribution_day between 1 and 28),
  target_date date not null default make_date(extract(year from current_date)::int,12,31),
  strategy text not null default 'balanced' check (strategy in ('minimum','balanced','fast')),
  updated_at timestamptz not null default now()
);
create table public.finance_debt_plan_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  amount numeric(14,2) not null check (amount <> 0),
  entry_date date not null,
  notes text,
  created_at timestamptz not null default now(),
  foreign key (account_id,user_id) references public.finance_accounts(id,user_id) on delete restrict
);
alter table public.finance_transactions
  add column debt_id uuid,
  add column debt_principal_amount numeric(14,2),
  add column debt_settlement boolean not null default false,
  add column plan_amount numeric(14,2) not null default 0,
  add foreign key (debt_id,user_id) references public.finance_debts(id,user_id) on delete restrict,
  add check (debt_principal_amount is null or (debt_principal_amount >= 0 and debt_principal_amount <= amount)),
  add check (plan_amount >= 0 and plan_amount <= amount),
  add check ((debt_id is not null and type in ('expense','debt_payment')) or (debt_id is null and plan_amount = 0 and not debt_settlement and debt_principal_amount is null));
alter table public.finance_recurring_transactions
  add column debt_id uuid,
  add foreign key (debt_id,user_id) references public.finance_debts(id,user_id) on delete restrict,
  add check (debt_id is null or type in ('expense','debt_payment'));
create index finance_debts_user_idx on public.finance_debts(user_id,status);
create index finance_debt_entries_user_idx on public.finance_debt_plan_entries(user_id,account_id);
create index finance_transactions_debt_idx on public.finance_transactions(debt_id,transaction_date);
alter table public.finance_debts enable row level security;
alter table public.finance_debt_plan_preferences enable row level security;
alter table public.finance_debt_plan_entries enable row level security;
create policy debt_owner on public.finance_debts for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy debt_preferences_owner on public.finance_debt_plan_preferences for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy debt_entries_read on public.finance_debt_plan_entries for select to authenticated using (user_id = (select auth.uid()));
grant select,insert,update,delete on public.finance_debts,public.finance_debt_plan_preferences to authenticated;
grant select on public.finance_debt_plan_entries to authenticated;
create trigger finance_debts_updated before update on public.finance_debts for each row execute function public.set_updated_at();
create trigger finance_debt_preferences_updated before update on public.finance_debt_plan_preferences for each row execute function public.set_updated_at();

create function public.validate_finance_debt_payment() returns trigger
language plpgsql set search_path = '' as $$
declare available numeric; linked_debt uuid;
begin
  -- Existing recurring registration RPCs inherit the link without a second movement.
  if new.recurring_transaction_id is not null and new.debt_id is null and tg_op = 'INSERT' then
    select debt_id into linked_debt from public.finance_recurring_transactions where id = new.recurring_transaction_id and user_id = new.user_id;
    new.debt_id := linked_debt;
  end if;
  if new.plan_amount > 0 and new.status = 'completed' then
    insert into public.finance_debt_plan_preferences(user_id) values(new.user_id) on conflict do nothing;
    perform 1 from public.finance_debt_plan_preferences where user_id = new.user_id for update;
    select coalesce(sum(amount),0) into available from public.finance_debt_plan_entries where user_id = new.user_id and account_id = new.account_id;
    select available - coalesce(sum(plan_amount),0) into available from public.finance_transactions
      where user_id = new.user_id and account_id = new.account_id and status = 'completed' and id <> new.id;
    if new.plan_amount > available then raise exception 'Saldo insuficiente en Plan para esta cuenta'; end if;
  end if;
  return new;
end; $$;
create trigger finance_debt_payment_validation before insert or update on public.finance_transactions for each row execute function public.validate_finance_debt_payment();

create function public.allocate_finance_debt_plan(target_id uuid,target_account uuid,target_amount numeric,target_date date,target_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); available numeric; account_cash numeric; reserved numeric;
begin
  if uid is null then raise exception 'Sesión inválida'; end if;
  if target_amount is null or target_amount = 0 or target_amount <> round(target_amount,2) or target_date > current_date then raise exception 'Aportación inválida'; end if;
  insert into public.finance_debt_plan_preferences(user_id) values(uid) on conflict do nothing;
  perform 1 from public.finance_debt_plan_preferences where user_id = uid for update;
  -- Idempotent for network retries, with collision detection.
  if exists(select 1 from public.finance_debt_plan_entries where id = target_id) then
    if exists(select 1 from public.finance_debt_plan_entries where id=target_id and user_id=uid and account_id=target_account and amount=target_amount and entry_date=target_date) then return; end if;
    raise exception 'Esta aportación ya existe con otros datos';
  end if;
  select initial_balance into account_cash from public.finance_accounts where id=target_account and user_id=uid and is_active and currency='MXN' for update;
  if not found then raise exception 'Selecciona una cuenta activa en MXN'; end if;
  select coalesce(sum(amount),0) into available from public.finance_debt_plan_entries where user_id=uid and account_id=target_account;
  select available-coalesce(sum(plan_amount),0) into available from public.finance_transactions where user_id=uid and account_id=target_account and status='completed';
  if target_amount < 0 and -target_amount > available then raise exception 'No puedes liberar más que el saldo de Plan'; end if;
  select account_cash + coalesce(sum(case
    when type in ('income','refund') and account_id=target_account then amount
    when type='transfer' and destination_account_id=target_account then amount
    when type in ('expense','debt_payment','saving','transfer') and account_id=target_account then -amount else 0 end),0)
    into account_cash from public.finance_transactions where user_id=uid and status='completed';
  select coalesce(sum(amount),0) into reserved from public.finance_debt_plan_entries where user_id=uid;
  select reserved-coalesce(sum(plan_amount),0) into reserved from public.finance_transactions where user_id=uid and status='completed';
  if target_amount > account_cash-available then raise exception 'La cuenta no tiene disponible suficiente para apartar ese monto'; end if;
  insert into public.finance_debt_plan_entries(id,user_id,account_id,amount,entry_date,notes) values(target_id,uid,target_account,target_amount,target_date,nullif(trim(target_notes),''));
end; $$;

create function public.link_finance_debt(target_debt uuid,target_recurring uuid default null,target_transaction uuid default null)
returns void language plpgsql set search_path = '' as $$
declare uid uuid := (select auth.uid()); previous_debt uuid;
begin
  if uid is null then raise exception 'Sesión inválida'; end if;
  if target_debt is not null and not exists(select 1 from public.finance_debts where id=target_debt and user_id=uid) then raise exception 'Deuda no encontrada'; end if;
  if (target_recurring is null) = (target_transaction is null) then raise exception 'Selecciona un movimiento o recurrente'; end if;
  if target_recurring is not null then
    select debt_id into previous_debt from public.finance_recurring_transactions where id=target_recurring and user_id=uid and type in ('expense','debt_payment') for update;
    if not found then raise exception 'Recurrente no encontrado'; end if;
    update public.finance_recurring_transactions set debt_id=target_debt where id=target_recurring and user_id=uid;
    update public.finance_transactions set debt_id=target_debt,debt_principal_amount=null,debt_settlement=false,plan_amount=case when target_debt is null then 0 else plan_amount end
      where recurring_transaction_id=target_recurring and user_id=uid and (debt_id is null or debt_id=previous_debt);
  else
    update public.finance_transactions set debt_id=target_debt,debt_principal_amount=null,debt_settlement=false,plan_amount=0
      where id=target_transaction and user_id=uid and type in ('expense','debt_payment');
    if not found then raise exception 'Movimiento no encontrado'; end if;
  end if;
end; $$;
revoke all on function public.allocate_finance_debt_plan(uuid,uuid,numeric,date,text),public.link_finance_debt(uuid,uuid,uuid),public.validate_finance_debt_payment() from public;
grant execute on function public.allocate_finance_debt_plan(uuid,uuid,numeric,date,text),public.link_finance_debt(uuid,uuid,uuid) to authenticated;
-- One visible category for actual payments made from the new envelope.
insert into public.finance_categories(user_id,name,type,icon,color,is_default)
select id,'Plan','expense','calendar-check','#6e91ff',true from auth.users on conflict(user_id,name,type) do nothing;
create function public.seed_finance_plan_category() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.finance_categories(user_id,name,type,icon,color,is_default) values(new.id,'Plan','expense','calendar-check','#6e91ff',true) on conflict(user_id,name,type) do nothing;
  return new;
end; $$;
revoke all on function public.seed_finance_plan_category() from public;
create trigger seed_finance_plan_after_signup after insert on auth.users for each row execute function public.seed_finance_plan_category();
notify pgrst,'reload schema';
