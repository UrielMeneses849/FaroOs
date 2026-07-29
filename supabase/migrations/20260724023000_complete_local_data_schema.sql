create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  goal_id uuid references public.goals(id) on delete set null,
  title text not null,
  description text,
  area text not null,
  status text not null default 'inbox'
    check (status in ('inbox', 'archived', 'converted')),
  idea_date date,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  description text not null,
  amount numeric(14, 2) not null check (amount >= 0),
  kind text not null check (kind in ('income', 'expense', 'saving')),
  category text not null,
  occurred_at date not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.goals
  add column if not exists archived_at timestamptz;

alter table public.projects
  add column if not exists priority public.task_priority not null default 'medium',
  add column if not exists archived_at timestamptz;

alter table public.tasks
  add column if not exists archived_at timestamptz;

alter table public.study_sessions
  add column if not exists archived_at timestamptz;

alter table public.health_logs
  add column if not exists movement_minutes integer
    check (movement_minutes is null or movement_minutes >= 0),
  add column if not exists training_minutes integer
    check (training_minutes is null or training_minutes >= 0),
  add column if not exists archived_at timestamptz;

alter table public.treatment_logs
  add column if not exists dosage_text text,
  add column if not exists skin_condition text,
  add column if not exists archived_at timestamptz;

alter table public.journal_entries
  add column if not exists area text,
  add column if not exists archived_at timestamptz;

alter table public.ideas enable row level security;
alter table public.transactions enable row level security;

create policy "Users can read own ideas"
  on public.ideas for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own ideas"
  on public.ideas for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update own ideas"
  on public.ideas for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own ideas"
  on public.ideas for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read own transactions"
  on public.transactions for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own transactions"
  on public.transactions for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update own transactions"
  on public.transactions for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own transactions"
  on public.transactions for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create index if not exists ideas_user_id_idx on public.ideas(user_id);
create index if not exists ideas_project_id_idx on public.ideas(project_id);
create index if not exists ideas_goal_id_idx on public.ideas(goal_id);
create index if not exists transactions_user_id_idx on public.transactions(user_id);
create index if not exists transactions_occurred_at_idx on public.transactions(occurred_at);
