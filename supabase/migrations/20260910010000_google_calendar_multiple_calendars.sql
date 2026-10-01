alter table public.google_calendar_connections
  add column if not exists calendar_ids text[] not null default '{}',
  add column if not exists calendar_names text[] not null default '{}';

update public.google_calendar_connections
set calendar_ids = case when calendar_id is null then '{}' else array[calendar_id] end,
    calendar_names = case when calendar_name is null then '{}' else array[calendar_name] end
where cardinality(calendar_ids) = 0 and calendar_id is not null;

grant select (calendar_ids, calendar_names) on public.google_calendar_connections to authenticated;
grant update (calendar_ids, calendar_names) on public.google_calendar_connections to authenticated;
