-- Stable, user-scoped ordering for the task Kanban.
alter table public.tasks
  add column if not exists sort_order bigint not null default 0;

with ranked as (
  select id,
    row_number() over (
      partition by user_id, workspace_id, status
      order by created_at, id
    ) * 1000 as next_order
  from public.tasks
)
update public.tasks
set sort_order = ranked.next_order
from ranked
where public.tasks.id = ranked.id
  and public.tasks.sort_order = 0;

create index if not exists tasks_user_workspace_status_order_idx
  on public.tasks(user_id, workspace_id, status, sort_order, id);

notify pgrst, 'reload schema';
