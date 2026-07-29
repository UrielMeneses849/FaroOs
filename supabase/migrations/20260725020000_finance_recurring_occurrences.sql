-- Monthly state for recurring finance templates.
-- Additive and non-destructive: existing templates and transactions remain intact.

create type public.finance_recurring_occurrence_status as enum
  ('pending', 'paid', 'skipped', 'postponed');

create table public.finance_recurring_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recurring_transaction_id uuid not null,
  period date not null check (period = date_trunc('month', period)::date),
  expected_date date not null,
  status public.finance_recurring_occurrence_status not null default 'pending',
  transaction_id uuid,
  paid_at timestamptz,
  skipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, recurring_transaction_id, period),
  foreign key (recurring_transaction_id, user_id)
    references public.finance_recurring_transactions(id, user_id)
    on delete cascade,
  foreign key (transaction_id, user_id)
    references public.finance_transactions(id, user_id)
    on delete restrict,
  check (
    (status = 'paid' and transaction_id is not null and paid_at is not null)
    or (status = 'skipped' and transaction_id is null and skipped_at is not null)
    or (status in ('pending', 'postponed') and transaction_id is null)
  )
);

create index finance_recurring_occurrences_user_period_idx
  on public.finance_recurring_occurrences(user_id, period, status);
create index finance_recurring_occurrences_recurring_idx
  on public.finance_recurring_occurrences(recurring_transaction_id, period);

create trigger finance_recurring_occurrences_updated_at
before update on public.finance_recurring_occurrences
for each row execute function public.set_updated_at();

alter table public.finance_recurring_occurrences enable row level security;

create policy "Users select own finance_recurring_occurrences"
  on public.finance_recurring_occurrences for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users insert own finance_recurring_occurrences"
  on public.finance_recurring_occurrences for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users update own finance_recurring_occurrences"
  on public.finance_recurring_occurrences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users delete own finance_recurring_occurrences"
  on public.finance_recurring_occurrences for delete to authenticated
  using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
