create table public.voice_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  language text not null default 'es-MX',
  voice text not null default 'marin',
  aliases jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.voice_action_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  source text not null check (source in ('text', 'voice')),
  transcript text,
  parsed_intent text,
  entities jsonb not null default '{}'::jsonb,
  questions jsonb not null default '[]'::jsonb,
  tool_name text,
  tool_arguments jsonb,
  confirmation_required boolean not null default false,
  confirmation_status text check (confirmation_status is null or confirmation_status in ('pending', 'confirmed', 'cancelled')),
  result jsonb,
  status text not null check (status in ('received', 'needs_clarification', 'pending_confirmation', 'completed', 'error')),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, request_id)
);

create index voice_action_logs_user_created_idx
  on public.voice_action_logs(user_id, created_at desc);

alter table public.voice_preferences enable row level security;
alter table public.voice_action_logs enable row level security;

create policy "Users manage own voice preferences" on public.voice_preferences
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users read own voice logs" on public.voice_action_logs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users create own voice logs" on public.voice_action_logs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own voice logs" on public.voice_action_logs
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.voice_preferences to authenticated;
grant select, insert, update on public.voice_action_logs to authenticated;

