-- FARO Needs MVP: a private, recurrent purchase checklist. These records are
-- deliberately separate from finance_transactions: replenishing an item must
-- never create a duplicate financial charge.
create table if not exists public.needs_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  category text not null default 'home'
    check (category in ('home', 'personal', 'cat', 'big_purchase', 'other')),
  priority text not null default 'soon'
    check (priority in ('essential', 'soon', 'planned')),
  frequency text not null default 'one_time'
    check (frequency in ('weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual', 'one_time')),
  next_needed_on date,
  estimated_amount numeric(14, 2) check (estimated_amount is null or estimated_amount >= 0),
  notes text,
  is_active boolean not null default true,
  last_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists needs_items_user_active_due_idx
  on public.needs_items (user_id, is_active, next_needed_on);

alter table public.needs_items enable row level security;

create policy "Users can read their needs"
  on public.needs_items for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their needs"
  on public.needs_items for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their needs"
  on public.needs_items for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their needs"
  on public.needs_items for delete to authenticated
  using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
