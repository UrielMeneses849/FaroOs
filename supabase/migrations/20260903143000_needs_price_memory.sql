-- A receipt teaches FARO a price history; it never creates a finance movement.
-- We intentionally keep ticket images/text out of the database. The user only
-- confirms the useful commercial facts: store, date, product and paid price.
create table if not exists public.needs_purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store_name text,
  purchased_on date not null default current_date,
  source_file_name text,
  total_amount numeric(14, 2) check (total_amount is null or total_amount >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.needs_price_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  receipt_id uuid not null references public.needs_purchase_receipts(id) on delete cascade,
  need_item_id uuid references public.needs_items(id) on delete set null,
  canonical_name text not null check (char_length(trim(canonical_name)) between 1 and 120),
  source_name text not null check (char_length(trim(source_name)) between 1 and 160),
  presentation text,
  amount numeric(14, 2) not null check (amount >= 0),
  observed_on date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists needs_price_observations_user_name_date_idx
  on public.needs_price_observations (user_id, lower(canonical_name), observed_on desc);
create index if not exists needs_price_observations_receipt_idx
  on public.needs_price_observations (receipt_id);

alter table public.needs_purchase_receipts enable row level security;
alter table public.needs_price_observations enable row level security;

create policy "Users can read their need receipts"
  on public.needs_purchase_receipts for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their need receipts"
  on public.needs_purchase_receipts for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their need receipts"
  on public.needs_purchase_receipts for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their learned need prices"
  on public.needs_price_observations for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create learned need prices"
  on public.needs_price_observations for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update learned need prices"
  on public.needs_price_observations for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete learned need prices"
  on public.needs_price_observations for delete to authenticated
  using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
