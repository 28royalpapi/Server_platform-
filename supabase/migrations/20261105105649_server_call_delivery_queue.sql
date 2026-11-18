-- Durable Server-to-Server call-wake queue.
-- Call creation and its notification job are committed in the same PostgreSQL transaction.
-- pgmq is private to server-side functions; no client role receives direct queue access.

do $$
begin
  if to_regclass('pgmq.q_server_call_delivery') is null then
    perform pgmq.create('server_call_delivery');
  end if;
end;
$$;

create table if not exists public.server_call_delivery_dispatch_gate (
  singleton boolean primary key default true check (singleton),
  next_kick_at timestamptz not null default '-infinity'::timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.server_call_delivery_dispatch_gate(singleton)
values (true) on conflict(singleton) do nothing;
alter table public.server_call_delivery_dispatch_gate enable row level security;
revoke all on public.server_call_delivery_dispatch_gate from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name='server_call_dispatch_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32),'hex'),
      'server_call_dispatch_secret',
      'Private authentication token for internal Server call-delivery worker dispatch'
    );
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name='server_publishable_key') then
    perform vault.create_secret(
      'sb_publishable_denBmNsOLdaEYPjFr4JxTA_XgElA64E',
      'server_publishable_key',
      'Public Supabase API key used only for internal pg_net Edge Function requests'
    );
  end if;
end;
$$;

create or replace function public.server_validate_call_dispatch_secret(p_token text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    p_token <> ''
    and p_token = (select decrypted_secret from vault.decrypted_secrets where name='server_call_dispatch_secret' limit 1),
    false
  );
$$;
revoke all on function public.server_validate_call_dispatch_secret(text) from public, anon, authenticated;
grant execute on function public.server_validate_call_dispatch_secret(text) to service_role;

create or replace function public.server_call_delivery_read_batch(
  p_quantity integer default 100,
  p_visibility_seconds integer default 60
)
returns setof jsonb
language sql
security definer
set search_path = ''
as $$
  select to_jsonb(m)
  from pgmq.read(
    'server_call_delivery',
    greatest(10,least(120,coalesce(p_visibility_seconds,60))),
    greatest(1,least(250,coalesce(p_quantity,100))),
    null::jsonb
  ) as m;
$$;
revoke all on function public.server_call_delivery_read_batch(integer,integer) from public, anon, authenticated;
grant execute on function public.server_call_delivery_read_batch(integer,integer) to service_role;

create or replace function public.server_call_delivery_ack_batch(
  p_message_ids bigint[],
  p_archive boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_count integer := 0;
  v_result boolean;
begin
  if p_message_ids is null then return 0; end if;
  foreach v_id in array p_message_ids loop
    if p_archive then
      select pgmq.archive('server_call_delivery',v_id) into v_result;
    else
      select pgmq.delete('server_call_delivery',v_id) into v_result;
    end if;
    if coalesce(v_result,false) then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.server_call_delivery_ack_batch(bigint[],boolean) from public, anon, authenticated;
grant execute on function public.server_call_delivery_ack_batch(bigint[],boolean) to service_role;

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
begin
  -- If the queue is empty or all messages are currently inside a visibility
  -- window, there is no work for another dispatcher invocation.
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

  -- Coalesce bursts into at most one pg_net wake every 150 ms. Workers read
  -- bounded batches and re-kick themselves while visible queue work remains.
  update public.server_call_delivery_dispatch_gate
     set next_kick_at=clock_timestamp()+interval '150 milliseconds',
         updated_at=clock_timestamp()
   where singleton=true and next_kick_at <= clock_timestamp();
  if not found then return null; end if;

  v_request_id := net.http_post(
    url:='https://hzuovekqsjtpvmbuybxs.supabase.co/functions/v1/server-call-delivery-worker',
    body:=jsonb_build_object('trigger','queue','requested_at',clock_timestamp()),
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
revoke all on function public.server_call_delivery_kick() from public, anon, authenticated;
grant execute on function public.server_call_delivery_kick() to service_role;

-- Replace the earlier non-queue version. Call state, membership rows, guest
-- invite, and Server wake-job are inserted atomically.
create or replace function public.server_create_call_atomic(
  p_caller_user_id uuid,
  p_callee_user_id uuid,
  p_callee_phone_e164 text,
  p_route text,
  p_expires_at timestamptz,
  p_invite_phone_e164 text default null,
  p_invite_token_hash text default null,
  p_invite_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.server_calls%rowtype;
  v_invite_id uuid := null;
  v_caller_server_id text;
  v_now timestamptz := now();
begin
  if p_caller_user_id is null then
    raise exception 'CALLER_REQUIRED' using errcode='22023';
  end if;
  if p_route not in ('server','guest') then
    raise exception 'INVALID_CALL_ROUTE' using errcode='22023';
  end if;
  if p_expires_at is null or p_expires_at <= v_now then
    raise exception 'INVALID_CALL_EXPIRY' using errcode='22023';
  end if;

  if p_route='server' then
    if p_callee_user_id is null or p_callee_user_id=p_caller_user_id then
      raise exception 'INVALID_SERVER_CALLEE' using errcode='22023';
    end if;
    if p_invite_phone_e164 is not null or p_invite_token_hash is not null or p_invite_expires_at is not null then
      raise exception 'UNEXPECTED_GUEST_INVITE' using errcode='22023';
    end if;
  else
    if p_callee_user_id is not null
      or p_invite_phone_e164 is null
      or p_invite_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
      or p_invite_token_hash is null
      or p_invite_token_hash !~ '^[0-9a-f]{64}$'
      or p_invite_expires_at is null
      or p_invite_expires_at <= v_now then
      raise exception 'INVALID_GUEST_INVITE' using errcode='22023';
    end if;
  end if;

  insert into public.server_calls (
    caller_user_id, callee_user_id, callee_phone_e164,
    route, state, created_at, updated_at, expires_at
  )
  values (
    p_caller_user_id, p_callee_user_id, p_callee_phone_e164,
    p_route, 'ringing', v_now, v_now, p_expires_at
  )
  returning * into v_call;

  insert into public.server_call_members (call_id,user_id,member_role)
  values (v_call.id,p_caller_user_id,'caller');

  if p_route='server' then
    insert into public.server_call_members (call_id,user_id,member_role)
    values (v_call.id,p_callee_user_id,'callee');

    select server_id into v_caller_server_id
      from public.server_profiles where user_id=p_caller_user_id;

    perform pgmq.send(
      'server_call_delivery',
      jsonb_build_object(
        'call_id',v_call.id,
        'recipient_user_id',p_callee_user_id,
        'caller_server_id',coalesce(v_caller_server_id,'A Server user')
      )
    );

    -- Queue persistence is transactional; the dispatch kick is best-effort.
    -- A cron recovery job below will kick any messages left behind.
    begin
      perform public.server_call_delivery_kick();
    exception when others then
      null;
    end;
  else
    insert into public.server_guest_invites (
      call_id,phone_e164,token_hash,expires_at
    )
    values (
      v_call.id,p_invite_phone_e164,p_invite_token_hash,p_invite_expires_at
    )
    returning id into v_invite_id;
  end if;

  return jsonb_build_object(
    'call',jsonb_build_object(
      'id',v_call.id,
      'state',v_call.state,
      'route',v_call.route,
      'created_at',v_call.created_at,
      'updated_at',v_call.updated_at,
      'expires_at',v_call.expires_at
    ),
    'invite_id',v_invite_id,
    'delivery_queued',p_route='server'
  );
end;
$$;
revoke all on function public.server_create_call_atomic(
  uuid,uuid,text,text,timestamptz,text,text,timestamptz
) from public,anon,authenticated;
grant execute on function public.server_create_call_atomic(
  uuid,uuid,text,text,timestamptz,text,text,timestamptz
) to service_role;

-- Recovery for deployments/restarts where the immediate dispatcher cannot run.
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
    from cron.job where jobname='server-call-delivery-recovery-every-minute' limit 1;
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
end;
$$;
select cron.schedule(
  'server-call-delivery-recovery-every-minute',
  '* * * * *',
  'select public.server_call_delivery_kick();'
);
