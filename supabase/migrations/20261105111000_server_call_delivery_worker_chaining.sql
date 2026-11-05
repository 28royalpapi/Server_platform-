-- Let an active queue worker chain the next batch immediately.
-- External call-start requests remain coalesced by server_call_delivery_kick().
create or replace function public.server_call_delivery_kick_continuation()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dispatch_secret text;
  v_publishable_key text;
  v_request_id bigint;
begin
  if not exists (
    select 1 from pgmq.q_server_call_delivery where vt <= clock_timestamp()
  ) then
    return null;
  end if;

  select decrypted_secret into v_dispatch_secret
    from vault.decrypted_secrets where name='server_call_dispatch_secret' limit 1;
  select decrypted_secret into v_publishable_key
    from vault.decrypted_secrets where name='server_publishable_key' limit 1;
  if coalesce(v_dispatch_secret,'')='' or coalesce(v_publishable_key,'')='' then
    return null;
  end if;

  v_request_id := net.http_post(
    url:='https://hzuovekqsjtpvmbuybxs.supabase.co/functions/v1/server-call-delivery-worker',
    body:=jsonb_build_object('trigger','worker-continuation','requested_at',clock_timestamp()),
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'apikey',v_publishable_key,
      'x-server-dispatch-token',v_dispatch_secret
    ),
    timeout_milliseconds:=2000
  );
  return v_request_id;
end;
$$;
revoke all on function public.server_call_delivery_kick_continuation() from public, anon, authenticated;
grant execute on function public.server_call_delivery_kick_continuation() to service_role;
