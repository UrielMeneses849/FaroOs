create table if not exists public.faro_improvements (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 180), description text,
  kind text not null check (kind in ('hotfix', 'evolution', 'feature')),
  area text not null default 'General',
  status text not null default 'open' check (status in ('open', 'reviewed', 'done')),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.faro_improvements enable row level security;
create policy "Users manage their FARO improvements" on public.faro_improvements for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
