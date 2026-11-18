-- Auditable worker-run counters independent of pg_net response retention.
create table if not exists public.server_call_delivery_worker_runs (
  id uuid primary key default gen_random_uuid(),
  slot_id smallint not null check (slot_id between 1 and 8),
  lease_id uuid not null,
  status text not null default 'running' check (status in ('running','completed','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  messages_read integer not null default 0 check (messages_read >= 0),
  messages_acked integer not null default 0 check (messages_acked >= 0),
  messages_archived integer not null default 0 check (messages_archived >= 0),
  messages_retried integer not null default 0 check (messages_retried >= 0),
  notifications_accepted integer not null default 0 check (notifications_accepted >= 0),
  notifications_skipped integer not null default 0 check (notifications_skipped >= 0),
  failure_code text,
  unique(slot_id,lease_id)
);
create index if not exists server_call_delivery_worker_runs_started_idx
  on public.server_call_delivery_worker_runs(started_at desc);
create index if not exists server_call_delivery_worker_runs_status_started_idx
  on public.server_call_delivery_worker_runs(status,started_at);

alter table public.server_call_delivery_worker_runs enable row level security;
revoke all on public.server_call_delivery_worker_runs from public,anon,authenticated;
grant select,insert,update,delete on public.server_call_delivery_worker_runs to service_role;
