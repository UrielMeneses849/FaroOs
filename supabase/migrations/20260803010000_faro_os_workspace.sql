-- FARO OS is an independent operational workspace for every existing user.
-- The unique (user_id, name) constraint makes this migration idempotent.
insert into public.workspaces (user_id, name, type, color, icon, is_active, sort_order)
select users.id, 'FARO OS', 'business', '#2457ff', 'sparkles', true, 5
from auth.users as users
on conflict (user_id, name) do update
set type = excluded.type,
    color = excluded.color,
    icon = excluded.icon,
    is_active = true;
