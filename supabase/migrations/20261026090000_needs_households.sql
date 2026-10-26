-- Household shopping is private and has no links or triggers into Finance.
create table public.needs_households (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision integer not null default 0 check (revision >= 0),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.needs_households enable row level security;
create policy "Read own household" on public.needs_households for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own household" on public.needs_households for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own household" on public.needs_households for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- A revision lease prevents two devices from silently overwriting purchases or
-- stock. A purchase and all its inventory changes are committed together.
create function public.save_needs_household(expected_revision integer, document jsonb)
returns integer language plpgsql security invoker set search_path = public as $$
declare next_revision integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if expected_revision = -1 then
    insert into public.needs_households(user_id, revision, data)
      values (auth.uid(), 0, document) on conflict (user_id) do nothing
      returning revision into next_revision;
  else
    update public.needs_households set data = document, revision = revision + 1, updated_at = now()
      where user_id = auth.uid() and revision = expected_revision
      returning revision into next_revision;
  end if;
  if next_revision is null then raise exception 'NEEDS_CONFLICT: reload before saving' using errcode = '40001'; end if;
  return next_revision;
end;
$$;
revoke all on function public.save_needs_household(integer, jsonb) from public, anon;
grant execute on function public.save_needs_household(integer, jsonb) to authenticated;
notify pgrst, 'reload schema';
