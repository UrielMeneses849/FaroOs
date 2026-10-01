-- Personal categories keep the shopping ritual flexible without changing the
-- existing five broad destinations (supermarket, pharmacy, cat, home, other).
create table if not exists public.needs_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  shopping_group text not null default 'supermarket'
    check (shopping_group in ('supermarket', 'pharmacy', 'cat', 'home', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create unique index if not exists needs_categories_user_name_ci_idx
  on public.needs_categories (user_id, lower(name));

alter table public.needs_items
  add column if not exists category_id uuid;

alter table public.needs_items
  drop constraint if exists needs_items_category_id_user_id_fkey;

alter table public.needs_items
  add constraint needs_items_category_id_user_id_fkey
  foreign key (category_id, user_id)
  references public.needs_categories(id, user_id)
  on delete set null (category_id);

alter table public.needs_categories enable row level security;

create policy "Users can read their need categories"
  on public.needs_categories for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their need categories"
  on public.needs_categories for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their need categories"
  on public.needs_categories for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their need categories"
  on public.needs_categories for delete to authenticated
  using ((select auth.uid()) = user_id);

create trigger needs_categories_updated_at
  before update on public.needs_categories
  for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
