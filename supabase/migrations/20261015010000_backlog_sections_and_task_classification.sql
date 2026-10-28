create table if not exists public.backlog_sections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  color text not null default '#5b8cff' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create unique index if not exists backlog_sections_workspace_name_unique
  on public.backlog_sections(user_id, workspace_id, lower(btrim(name)))
  where archived_at is null;

create index if not exists backlog_sections_workspace_order_idx
  on public.backlog_sections(user_id, workspace_id, sort_order, name)
  where archived_at is null;

alter table public.tasks
  add column if not exists section_id uuid references public.backlog_sections(id) on delete set null,
  add column if not exists task_type text
    check (task_type is null or task_type in ('bug','feature','ui','tech','research','content'));

create index if not exists tasks_user_workspace_section_idx
  on public.tasks(user_id, workspace_id, section_id)
  where archived_at is null;

create index if not exists tasks_user_workspace_type_idx
  on public.tasks(user_id, workspace_id, task_type)
  where archived_at is null;

create or replace function public.validate_task_backlog_section()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.section_id is null then return new; end if;
  if not exists (
    select 1 from public.backlog_sections section
    where section.id = new.section_id
      and section.user_id = new.user_id
      and section.workspace_id = new.workspace_id
      and section.archived_at is null
  ) then
    raise exception 'La sección debe pertenecer al mismo workspace y usuario que la tarea.';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_validate_backlog_section on public.tasks;
create trigger tasks_validate_backlog_section
before insert or update of section_id, workspace_id, user_id on public.tasks
for each row execute function public.validate_task_backlog_section();

drop trigger if exists backlog_sections_updated_at on public.backlog_sections;
create trigger backlog_sections_updated_at
before update on public.backlog_sections
for each row execute function public.set_updated_at();

alter table public.backlog_sections enable row level security;

create policy "Users select own backlog_sections"
  on public.backlog_sections for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users insert own backlog_sections"
  on public.backlog_sections for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.workspaces workspace
      where workspace.id = workspace_id and workspace.user_id = (select auth.uid())
    )
  );

create policy "Users update own backlog_sections"
  on public.backlog_sections for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.workspaces workspace
      where workspace.id = workspace_id and workspace.user_id = (select auth.uid())
    )
  );

create policy "Users delete own backlog_sections"
  on public.backlog_sections for delete to authenticated
  using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
