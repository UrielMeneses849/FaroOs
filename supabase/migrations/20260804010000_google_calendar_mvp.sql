create table if not exists public.google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  google_account_email text,
  calendar_id text,
  calendar_name text,
  encrypted_refresh_token text not null,
  refresh_token_iv text not null,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  status text not null default 'needs_calendar'
    check (status in ('needs_calendar', 'active', 'reconnect_required')),
  updated_at timestamptz not null default now()
);

create table if not exists public.google_calendar_oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists google_calendar_oauth_states_expiry_idx
  on public.google_calendar_oauth_states (expires_at);

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_oauth_states enable row level security;

create policy "Users can read their Google Calendar connection"
  on public.google_calendar_connections for select
  using (auth.uid() = user_id);
create policy "Users can update their Google Calendar connection"
  on public.google_calendar_connections for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can disconnect their Google Calendar"
  on public.google_calendar_connections for delete
  using (auth.uid() = user_id);

revoke all on public.google_calendar_connections from anon, authenticated;
grant select (id, user_id, google_account_email, calendar_id, calendar_name, connected_at, last_synced_at, status, updated_at)
  on public.google_calendar_connections to authenticated;
grant update (calendar_id, calendar_name, status, updated_at)
  on public.google_calendar_connections to authenticated;
grant delete on public.google_calendar_connections to authenticated;
revoke all on public.google_calendar_oauth_states from anon, authenticated;

