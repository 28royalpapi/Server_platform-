-- Remove transient WebRTC signalling payloads soon after a call is terminal.
-- Keep the call's minimal lifecycle metadata for the existing 30-day retention period.
-- This does not store or delete audio; audio is exchanged by the WebRTC media path.

create index if not exists server_calls_terminal_signal_cleanup_idx
  on public.server_calls ((coalesce(ended_at, updated_at)), id)
  where state in ('ended', 'missed', 'failed');

create or replace function public.server_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requeued integer := 0;
  v_failed integer := 0;
  v_missed integer := 0;
  v_timed_out integer := 0;
  v_purged_sms integer := 0;
  v_purged_calls integer := 0;
  v_purged_signals integer := 0;
begin
  update public.server_sms_jobs
     set status='queued', gateway_device_id=null, lease_until=null,
         updated_at=now(), error_code=null
   where status='leased' and lease_until < now() and attempts < 3 and body is not null;
  get diagnostics v_requeued = row_count;

  update public.server_sms_jobs
     set status='failed', body=null, lease_until=null, error_code='RETRY_LIMIT_REACHED', updated_at=now()
   where status='leased' and lease_until < now() and attempts >= 3;
  get diagnostics v_failed = row_count;

  update public.server_calls
     set state='missed', ended_at=coalesce(ended_at,now()), updated_at=now()
   where state='ringing'
     and (
       (expires_at is not null and expires_at <= now())
       or (expires_at is null and created_at < now() - interval '5 minutes')
     );
  get diagnostics v_missed = row_count;

  update public.server_calls
     set state='failed', ended_at=coalesce(ended_at,now()), updated_at=now()
   where state='connecting'
     and (
       (expires_at is not null and expires_at <= now())
       or (expires_at is null and updated_at < now() - interval '10 minutes')
     );
  get diagnostics v_timed_out = row_count;

  update public.server_sms_jobs set body=null, updated_at=now()
   where status in ('sent','delivered','failed') and body is not null;
  delete from public.server_sms_jobs
   where status in ('sent','delivered','failed') and created_at < now() - interval '30 days';
  get diagnostics v_purged_sms = row_count;

  -- Delete at most 25,000 signal payloads per maintenance run to bound lock
  -- duration and WAL spikes. The job runs every minute and drains any backlog.
  -- Ten minutes after terminal state is long enough for late hangup/reconnect
  -- handling, while avoiding 30-day retention of SDP and ICE candidates.
  with expired_calls as materialized (
    select id
      from public.server_calls
     where state in ('ended','missed','failed')
       and coalesce(ended_at,updated_at) < now() - interval '10 minutes'
     order by coalesce(ended_at,updated_at), id
     limit 5000
  ),
  expired_signals as (
    select s.seq
      from public.server_call_signals s
      join expired_calls c on c.id=s.call_id
     order by s.seq
     limit 25000
  )
  delete from public.server_call_signals s
   using expired_signals e
   where s.seq=e.seq;
  get diagnostics v_purged_signals = row_count;

  delete from public.server_gateway_pairings where expires_at < now() - interval '1 day';
  delete from public.server_rate_limits where window_started_at < now() - interval '2 days';
  delete from public.server_guest_invites where expires_at < now() - interval '30 days';
  delete from public.server_calls where state in ('ended','missed','failed') and coalesce(ended_at,updated_at) < now() - interval '30 days';
  get diagnostics v_purged_calls = row_count;

  return jsonb_build_object(
    'ran_at',now(),
    'sms_jobs_requeued',v_requeued,
    'sms_jobs_failed',v_failed,
    'calls_marked_missed',v_missed,
    'calls_timed_out',v_timed_out,
    'sms_jobs_purged',v_purged_sms,
    'signals_purged',v_purged_signals,
    'calls_purged',v_purged_calls
  );
end;
$$;

-- Preserve maintenance as an internal service operation only.
revoke all on function public.server_maintenance() from public, anon, authenticated;
grant execute on function public.server_maintenance() to service_role;

comment on function public.server_maintenance() is
  'Server internal maintenance; expires signalling payloads 10 minutes after terminal calls and retains minimal call metadata for 30 days.';
