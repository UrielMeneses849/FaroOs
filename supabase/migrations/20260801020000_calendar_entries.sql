create table if not exists public.calendar_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  linked_task_id uuid references public.tasks(id) on delete set null,
  kind text not null check (kind in ('event', 'focus')),
  title text not null check (char_length(trim(title)) > 0),
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_entries_valid_range check (ends_at > starts_at)
);

create index if not exists calendar_entries_user_starts_at_idx
  on public.calendar_entries (user_id, starts_at);

alter table public.calendar_entries enable row level security;

create policy "Users can read their calendar entries"
  on public.calendar_entries for select using (auth.uid() = user_id);
create policy "Users can create their calendar entries"
  on public.calendar_entries for insert with check (auth.uid() = user_id);
create policy "Users can update their calendar entries"
  on public.calendar_entries for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their calendar entries"
  on public.calendar_entries for delete using (auth.uid() = user_id);
