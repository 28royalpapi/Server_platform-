-- Fan out queue processing across a bounded worker pool.
-- pgmq.read() uses FOR UPDATE SKIP LOCKED, so concurrent workers claim disjoint jobs.
alter table public.server_call_delivery_dispatch_gate
  add column if not exists next_continuation_at timestamptz not null default '-infinity'::timestamptz;

create or replace function public.server_call_delivery_kick()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dispatch_secret text;
  v_publishable_key text;
  v_request_id bigint;
  v_visible_count bigint;
  v_worker_count integer;
  v_worker integer;
begin
  select count(*) into v_visible_count
    from pgmq.q_server_call_delivery
   where vt <= clock_timestamp();
  if v_visible_count <= 0 then return null; end if;

  select decrypted_secret into v_dispatch_secret
    from vault.decrypted_secrets where name='server_call_dispatch_secret' limit 1;
  select decrypted_secret into v_publishable_key
    from vault.decrypted_secrets where name='server_publishable_key' limit 1;
  if coalesce(v_dispatch_secret,'')='' or coalesce(v_publishable_key,'')='' then
    return null;
  end if;

  update public.server_call_delivery_dispatch_gate
     set next_kick_at=clock_timestamp()+interval '150 milliseconds',
         updated_at=clock_timestamp()
   where singleton=true and next_kick_at <= clock_timestamp();
  if not found then return null; end if;

  -- One worker claims at most one 250-message batch per invocation.
  -- Cap the initial fan-out at eight workers; continuation fans out again
  -- as each batch is acknowledged and more messages become visible.
  v_worker_count := least(8,greatest(1,ceil(v_visible_count::numeric/250)::integer));
  for v_worker in 1..v_worker_count loop
    v_request_id := net.http_post(
      url:='https://hzuovekqsjtpvmbuybxs.supabase.co/functions/v1/server-call-delivery-worker',
      body:=jsonb_build_object('trigger','queue','requested_at',clock_timestamp(),'worker_slot',v_worker),
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'apikey',v_publishable_key,
        'x-server-dispatch-token',v_dispatch_secret
      ),
      timeout_milliseconds:=10000
    );
  end loop;
  return v_request_id;
end;
$$;
revoke all on function public.server_call_delivery_kick() from public, anon, authenticated;
grant execute on function public.server_call_delivery_kick() to service_role;

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
  v_visible_count bigint;
  v_worker_count integer;
  v_worker integer;
begin
  select count(*) into v_visible_count
    from pgmq.q_server_call_delivery
   where vt <= clock_timestamp();
  if v_visible_count <= 0 then return null; end if;

  select decrypted_secret into v_dispatch_secret
    from vault.decrypted_secrets where name='server_call_dispatch_secret' limit 1;
  select decrypted_secret into v_publishable_key
    from vault.decrypted_secrets where name='server_publishable_key' limit 1;
  if coalesce(v_dispatch_secret,'')='' or coalesce(v_publishable_key,'')='' then
    return null;
  end if;

  -- A separate gate coalesces simultaneous worker completions into one pool
  -- fan-out, without blocking new external call-start kicks.
  update public.server_call_delivery_dispatch_gate
     set next_continuation_at=clock_timestamp()+interval '150 milliseconds',
         updated_at=clock_timestamp()
   where singleton=true and next_continuation_at <= clock_timestamp();
  if not found then return null; end if;

  v_worker_count := least(8,greatest(1,ceil(v_visible_count::numeric/250)::integer));
  for v_worker in 1..v_worker_count loop
    v_request_id := net.http_post(
      url:='https://hzuovekqsjtpvmbuybxs.supabase.co/functions/v1/server-call-delivery-worker',
      body:=jsonb_build_object('trigger','worker-continuation','requested_at',clock_timestamp(),'worker_slot',v_worker),
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'apikey',v_publishable_key,
        'x-server-dispatch-token',v_dispatch_secret
      ),
      timeout_milliseconds:=10000
    );
  end loop;
  return v_request_id;
end;
$$;
revoke all on function public.server_call_delivery_kick_continuation() from public, anon, authenticated;
grant execute on function public.server_call_delivery_kick_continuation() to service_role;
