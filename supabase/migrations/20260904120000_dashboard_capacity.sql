-- FARO Dashboard Capacity v1. The browser gets an exact database measure,
-- never credentials or table contents. The Free-plan ceiling remains a UI
-- policy so it can be changed independently when the project plan changes.
create or replace function public.faro_database_capacity()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  database_bytes bigint;
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesión FARO para consultar capacidad.';
  end if;

  select pg_database_size(current_database()) into database_bytes;
  return jsonb_build_object(
    'databaseBytes', database_bytes,
    'measuredAt', now()
  );
end;
$$;

revoke all on function public.faro_database_capacity() from public;
grant execute on function public.faro_database_capacity() to authenticated;
