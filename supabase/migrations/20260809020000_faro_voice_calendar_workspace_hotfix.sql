create or replace function public.prepare_ai_calendar_scenario(
  p_anchor_date date default current_date,
  p_confirm_is_test_user boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  faro_workspace_id uuid;
  bimsa_workspace_id uuid;
  tomorrow date := p_anchor_date + 1;
  full_day date := p_anchor_date + 2;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if not p_confirm_is_test_user then raise exception 'Confirm that this is a dedicated test user'; end if;

  insert into public.workspaces(user_id,name,type,color,is_active,sort_order)
  values(uid,'FARO OS','personal','#2868ff',true,1)
  on conflict(user_id,name) do update set is_active=true,color=excluded.color
  returning id into faro_workspace_id;

  insert into public.workspaces(user_id,name,type,color,is_active,sort_order)
  values(uid,'BIMSA','business','#ff9718',true,2)
  on conflict(user_id,name) do update set is_active=true,color=excluded.color
  returning id into bimsa_workspace_id;

  delete from public.calendar_entries where user_id=uid and title like '[LAB]%';
  delete from public.tasks where user_id=uid and title like '[LAB]%';
  delete from public.calendar_voice_fixtures where user_id=uid;

  insert into public.calendar_entries(user_id,workspace_id,kind,title,starts_at,ends_at,all_day)
  values
    (uid,bimsa_workspace_id,'event','[LAB] Reunión BIMSA',make_timestamptz(extract(year from tomorrow)::int,extract(month from tomorrow)::int,extract(day from tomorrow)::int,10,0,0,'America/Mexico_City'),make_timestamptz(extract(year from tomorrow)::int,extract(month from tomorrow)::int,extract(day from tomorrow)::int,11,0,0,'America/Mexico_City'),false),
    (uid,faro_workspace_id,'focus','[LAB] Bloque FARO',make_timestamptz(extract(year from tomorrow)::int,extract(month from tomorrow)::int,extract(day from tomorrow)::int,13,0,0,'America/Mexico_City'),make_timestamptz(extract(year from tomorrow)::int,extract(month from tomorrow)::int,extract(day from tomorrow)::int,14,30,0,'America/Mexico_City'),false),
    (uid,faro_workspace_id,'event','[LAB] Reunión de seguimiento',make_timestamptz(extract(year from full_day)::int,extract(month from full_day)::int,extract(day from full_day)::int,9,0,0,'America/Mexico_City'),make_timestamptz(extract(year from full_day)::int,extract(month from full_day)::int,extract(day from full_day)::int,12,0,0,'America/Mexico_City'),false),
    (uid,faro_workspace_id,'event','[LAB] Reunión de revisión',make_timestamptz(extract(year from full_day)::int,extract(month from full_day)::int,extract(day from full_day)::int,12,0,0,'America/Mexico_City'),make_timestamptz(extract(year from full_day)::int,extract(month from full_day)::int,extract(day from full_day)::int,18,0,0,'America/Mexico_City'),false);

  insert into public.tasks(user_id,workspace_id,title,area,status,priority,due_at,estimated_minutes)
  values(uid,faro_workspace_id,'[LAB] Preparar demo de FARO','personal','todo','medium',make_timestamptz(extract(year from tomorrow)::int,extract(month from tomorrow)::int,extract(day from tomorrow)::int,15,0,0,'America/Mexico_City'),60);

  insert into public.calendar_voice_fixtures(user_id,title,starts_at,ends_at,source,calendar_id,external_id,etag)
  values(uid,'[LAB Google] Daily externo',make_timestamptz(extract(year from tomorrow)::int,extract(month from tomorrow)::int,extract(day from tomorrow)::int,17,0,0,'America/Mexico_City'),make_timestamptz(extract(year from tomorrow)::int,extract(month from tomorrow)::int,extract(day from tomorrow)::int,17,30,0,'America/Mexico_City'),'google','lab-google','lab-daily','"lab-etag-1"');

  return jsonb_build_object('anchorDate',p_anchor_date,'tomorrow',tomorrow,'fullDay',full_day,'workspaceId',faro_workspace_id,'faroWorkspaceId',faro_workspace_id,'bimsaWorkspaceId',bimsa_workspace_id);
end;
$$;

revoke all on function public.prepare_ai_calendar_scenario(date,boolean) from public;
grant execute on function public.prepare_ai_calendar_scenario(date,boolean) to authenticated;
notify pgrst, 'reload schema';
