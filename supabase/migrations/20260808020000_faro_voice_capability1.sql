alter table public.voice_action_logs
  add column if not exists session_id uuid,
  add column if not exists surface text,
  add column if not exists skill text,
  add column if not exists route text,
  add column if not exists timings jsonb not null default '{}'::jsonb,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb,
  add column if not exists execution_status text not null default 'received',
  add column if not exists execution_attempts integer not null default 0,
  add column if not exists last_attempt_at timestamptz;

alter table public.voice_action_logs
  drop constraint if exists voice_action_logs_execution_status_check;

alter table public.voice_action_logs
  add constraint voice_action_logs_execution_status_check
  check (execution_status in ('received', 'pending', 'executing', 'completed', 'failed', 'cancelled'));

create index if not exists voice_action_logs_session_created_idx
  on public.voice_action_logs(user_id, session_id, created_at desc);

create or replace function public.claim_voice_action(target_request_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  action_row public.voice_action_logs%rowtype;
begin
  select * into action_row
  from public.voice_action_logs
  where user_id = auth.uid() and request_id = target_request_id
  for update;

  if action_row.id is null then
    return jsonb_build_object('state', 'missing');
  end if;

  if action_row.confirmation_status = 'cancelled' or action_row.execution_status = 'cancelled' then
    return jsonb_build_object('state', 'cancelled');
  end if;

  if action_row.execution_status = 'completed' or action_row.status = 'completed' then
    return jsonb_build_object(
      'state', 'completed',
      'toolName', action_row.tool_name,
      'arguments', coalesce(action_row.tool_arguments, '{}'::jsonb),
      'result', action_row.result
    );
  end if;

  if action_row.execution_status = 'executing'
    and action_row.last_attempt_at is not null
    and action_row.last_attempt_at > now() - interval '45 seconds' then
    return jsonb_build_object('state', 'executing');
  end if;

  if action_row.confirmation_status not in ('pending', 'confirmed')
    or action_row.tool_name is null
    or action_row.tool_arguments is null then
    return jsonb_build_object('state', 'invalid');
  end if;

  update public.voice_action_logs
  set confirmation_status = 'confirmed',
      execution_status = 'executing',
      execution_attempts = execution_attempts + 1,
      last_attempt_at = now(),
      error_message = null
  where id = action_row.id;

  return jsonb_build_object(
    'state', 'claimed',
    'toolName', action_row.tool_name,
    'arguments', action_row.tool_arguments,
    'attempt', action_row.execution_attempts + 1
  );
end;
$$;

revoke all on function public.claim_voice_action(uuid) from public;
grant execute on function public.claim_voice_action(uuid) to authenticated;
