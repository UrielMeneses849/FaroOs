-- Editable FARO Voice proposals retain their bounded conversational state on
-- the same server-owned action row that enforces confirmation and idempotency.
alter table public.voice_action_logs
  add column if not exists pending_context jsonb not null default '{}'::jsonb;

comment on column public.voice_action_logs.pending_context is
  'Server-owned, bounded context for an editable pending FARO Voice proposal; never copied to aggregate observability metrics.';
