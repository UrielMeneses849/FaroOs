-- Weekly execution cycles, explicit contribution origin and compatible task-state cleanup.

alter table public.finance_goal_contributions
  add column if not exists contribution_source text not null default 'previously_reserved'
    check (contribution_source in ('from_account','previously_reserved')),
  add column if not exists description text;

create or replace function public.register_finance_goal_contribution(
  target_goal_id uuid, target_amount numeric, target_date date,
  target_source text, target_account_id uuid default null,
  target_description text default null, target_notes text default null
)
returns uuid language plpgsql set search_path = '' as $$
declare contribution_id uuid := gen_random_uuid(); category_id uuid; transaction_id uuid;
begin
  if target_amount <= 0 then raise exception 'El monto debe ser mayor que cero'; end if;
  if target_source not in ('from_account','previously_reserved') then raise exception 'Origen inválido'; end if;
  if not exists(select 1 from public.finance_goals where id=target_goal_id and user_id=(select auth.uid())) then raise exception 'Meta no encontrada'; end if;
  if target_source='from_account' then
    if target_account_id is null then raise exception 'Selecciona una cuenta'; end if;
    select id into category_id from public.finance_categories where user_id=(select auth.uid()) and type='saving' and is_active limit 1;
    if category_id is null then raise exception 'No existe una categoría de ahorro activa'; end if;
    transaction_id := contribution_id;
    insert into public.finance_transactions(id,user_id,account_id,category_id,type,amount,transaction_date,description,status)
    values(transaction_id,(select auth.uid()),target_account_id,category_id,'saving',target_amount,target_date,coalesce(nullif(target_description,''),'Aportación a meta'),'completed');
  end if;
  insert into public.finance_goal_contributions(id,user_id,goal_id,account_id,amount,contribution_date,notes,transaction_id,contribution_source,description)
  values(contribution_id,(select auth.uid()),target_goal_id,target_account_id,target_amount,target_date,target_notes,transaction_id,target_source,target_description);
  return contribution_id;
end $$;
revoke all on function public.register_finance_goal_contribution(uuid,numeric,date,text,uuid,text,text) from public;
grant execute on function public.register_finance_goal_contribution(uuid,numeric,date,text,uuid,text,text) to authenticated;

update public.tasks set status = 'todo' where status in ('inbox','paused');

create table public.sprints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(length(btrim(name)) between 1 and 120),
  start_date date not null, end_date date not null,
  status text not null default 'planning' check(status in ('planning','active','completed','cancelled')),
  main_outcome text not null check(length(btrim(main_outcome)) > 0),
  capacity_minutes integer check(capacity_minutes is null or capacity_minutes >= 0),
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(end_date >= start_date), unique(id,user_id)
);
create unique index sprints_one_active_user_idx on public.sprints(user_id) where status = 'active';
create index sprints_user_dates_idx on public.sprints(user_id,start_date desc);

create table public.sprint_outcomes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  sprint_id uuid not null, title text not null,
  type text not null check(type in ('main','secondary')),
  status text not null default 'pending' check(status in ('pending','in_progress','completed','dropped')),
  sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(sprint_id,user_id) references public.sprints(id,user_id) on delete cascade
);
create unique index sprint_one_main_outcome_idx on public.sprint_outcomes(sprint_id) where type = 'main';
create index sprint_outcomes_sprint_idx on public.sprint_outcomes(sprint_id,sort_order);

create table public.sprint_tasks (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  sprint_id uuid not null, task_id uuid not null references public.tasks(id) on delete cascade,
  commitment_type text not null default 'committed' check(commitment_type in ('committed','emergent','optional')),
  added_at timestamptz not null default now(), completed_in_sprint boolean not null default false,
  removed_at timestamptz, created_at timestamptz not null default now(),
  foreign key(sprint_id,user_id) references public.sprints(id,user_id) on delete cascade,
  unique(user_id,sprint_id,task_id)
);
create index sprint_tasks_sprint_idx on public.sprint_tasks(sprint_id,commitment_type);
create index sprint_tasks_task_idx on public.sprint_tasks(task_id);

create table public.sprint_reviews (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  sprint_id uuid not null, summary text, wins text, blockers text, lessons text, carry_over_notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(sprint_id,user_id) references public.sprints(id,user_id) on delete cascade,
  unique(user_id,sprint_id)
);

do $$
declare t text;
begin
  foreach t in array array['sprints','sprint_outcomes','sprint_tasks','sprint_reviews'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy "Users select own %1$s" on public.%1$I for select to authenticated using ((select auth.uid())=user_id)',t);
    execute format('create policy "Users insert own %1$s" on public.%1$I for insert to authenticated with check ((select auth.uid())=user_id)',t);
    execute format('create policy "Users update own %1$s" on public.%1$I for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',t);
    execute format('create policy "Users delete own %1$s" on public.%1$I for delete to authenticated using ((select auth.uid())=user_id)',t);
  end loop;
end $$;
create trigger sprints_updated_at before update on public.sprints for each row execute function public.set_updated_at();
create trigger sprint_outcomes_updated_at before update on public.sprint_outcomes for each row execute function public.set_updated_at();
create trigger sprint_reviews_updated_at before update on public.sprint_reviews for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
