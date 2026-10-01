-- A goal is planning metadata. Removing it must never remove the cash ledger
-- or prevent deletion solely because an old budget closure referenced it.
do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.finance_budget_closures'::regclass
    and contype = 'f'
    and confrelid = 'public.finance_goals'::regclass
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.finance_budget_closures drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.finance_budget_closures
  add constraint finance_budget_closures_goal_id_user_id_fkey
  foreign key (goal_id, user_id)
  references public.finance_goals(id, user_id)
  on delete set null (goal_id);
