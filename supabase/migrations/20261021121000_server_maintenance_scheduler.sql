create extension if not exists pg_cron;

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
     set state='missed', updated_at=now()
   where state='ringing' and created_at < now() - interval '5 minutes';
  get diagnostics v_missed = row_count;

  update public.server_calls
     set state='failed', ended_at=coalesce(ended_at,now()), updated_at=now()
   where state='connecting' and updated_at < now() - interval '10 minutes';
  get diagnostics v_timed_out = row_count;

  update public.server_sms_jobs set body=null, updated_at=now()
   where status in ('sent','delivered','failed') and body is not null;
  delete from public.server_sms_jobs
   where status in ('sent','delivered','failed') and created_at < now() - interval '30 days';
  get diagnostics v_purged_sms = row_count;

  delete from public.server_gateway_pairings where expires_at < now() - interval '1 day';
  delete from public.server_rate_limits where window_started_at < now() - interval '2 days';
  delete from public.server_guest_invites where expires_at < now() - interval '30 days';
  delete from public.server_calls where state in ('ended','missed','failed') and coalesce(ended_at,updated_at) < now() - interval '30 days';
  get diagnostics v_purged_calls = row_count;

  return jsonb_build_object('ran_at',now(),'sms_jobs_requeued',v_requeued,'sms_jobs_failed',v_failed,
    'calls_marked_missed',v_missed,'calls_timed_out',v_timed_out,'sms_jobs_purged',v_purged_sms,'calls_purged',v_purged_calls);
end;
$$;

revoke all on function public.server_maintenance() from public, anon, authenticated;
grant execute on function public.server_maintenance() to service_role;

select cron.schedule('server-maintenance-every-5-minutes','*/5 * * * *','select public.server_maintenance();');
