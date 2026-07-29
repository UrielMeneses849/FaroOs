alter table public.workspaces
  add constraint workspaces_user_name_key unique (user_id, name);
