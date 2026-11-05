-- Bound the delivery service to eight leased workers.
-- Each worker must claim a DB slot before it can read a PGMQ batch.
create table if not exists public.server_call_delivery_worker_slots (
  slot_id smallint primary key check (slot_id between 1 and 8),
  lease_id uuid,
  lease_until timestamptz not null default '-infinity'::timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.server_call_delivery_worker_slots(slot_id)
select gs::smallint from generate_series(1,8) as gs
on conflict(slot_id) do nothing;
alter table public.server_call_delivery_worker_slots enable row level security;
revoke all on public.server_call_delivery_worker_slots from public,anon,authenticated;

create or replace function public.server_call_delivery_claim_worker_slots(
  p_limit integer default 8,
  p_lease_seconds integer default 90
)
returns table(slot_id smallint,lease_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with available as (
    select s.slot_id
      from public.server_call_delivery_worker_slots s
     where s.lease_until <= clock_timestamp()
     order by s.slot_id
     limit greatest(1,least(8,coalesce(p_limit,8)))
     for update skip locked
  ),
  claimed as (
    update public.server_call_delivery_worker_slots s
       set lease_id=gen_random_uuid(),
           lease_until=clock_timestamp()+make_interval(secs=>greatest(30,least(180,coalesce(p_lease_seconds,90)))),
           updated_at=clock_timestamp()
      from available a
     where s.slot_id=a.slot_id
     returning s.slot_id,s.lease_id
  )
  select claimed.slot_id,claimed.lease_id from claimed order by claimed.slot_id;
end;
$$;
revoke all on function public.server_call_delivery_claim_worker_slots(integer,integer) from public,anon,authenticated;
grant execute on function public.server_call_delivery_claim_worker_slots(integer,integer) to service_role;

create or replace function public.server_call_delivery_worker_slot_valid(
  p_slot_id smallint,
  p_lease_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.server_call_delivery_worker_slots
     where slot_id=p_slot_id and lease_id=p_lease_id and lease_until>clock_timestamp()
  );
$$;
revoke all on function public.server_call_delivery_worker_slot_valid(smallint,uuid) from public,anon,authenticated;
grant execute on function public.server_call_delivery_worker_slot_valid(smallint,uuid) to service_role;

create or replace function public.server_call_delivery_release_worker_slot(
  p_slot_id smallint,
  p_lease_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  update public.server_call_delivery_worker_slots
     set lease_id=null,lease_until='-infinity'::timestamptz,updated_at=clock_timestamp()
   where slot_id=p_slot_id and lease_id=p_lease_id;
  get diagnostics v_count = row_count;
  return v_count=1;
end;
$$;
revoke all on function public.server_call_delivery_release_worker_slot(smallint,uuid) from public,anon,authenticated;
grant execute on function public.server_call_delivery_release_worker_slot(smallint,uuid) to service_role;

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
  v_worker record;
begin
  if not exists (select 1 from pgmq.q_server_call_delivery where vt<=clock_timestamp()) then
    return null;
  end if;
  select decrypted_secret into v_dispatch_secret from vault.decrypted_secrets where name='server_call_dispatch_secret' limit 1;
  select decrypted_secret into v_publishable_key from vault.decrypted_secrets where name='server_publishable_key' limit 1;
  if coalesce(v_dispatch_secret,'')='' or coalesce(v_publishable_key,'')='' then return null; end if;

  update public.server_call_delivery_dispatch_gate
     set next_kick_at=clock_timestamp()+interval '150 milliseconds',updated_at=clock_timestamp()
   where singleton=true and next_kick_at<=clock_timestamp();
  if not found then return null; end if;

  for v_worker in
    select * from public.server_call_delivery_claim_worker_slots(8,90)
  loop
    v_request_id:=net.http_post(
      url:='https://hzuovekqsjtpvmbuybxs.supabase.co/functions/v1/server-call-delivery-worker',
      body:=jsonb_build_object('trigger','queue','worker_slot',v_worker.slot_id,'worker_lease_id',v_worker.lease_id),
      headers:=jsonb_build_object('Content-Type','application/json','apikey',v_publishable_key,'x-server-dispatch-token',v_dispatch_secret),
      timeout_milliseconds:=10000
    );
  end loop;
  return v_request_id;
end;
$$;
revoke all on function public.server_call_delivery_kick() from public,anon,authenticated;
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
  v_worker record;
begin
  if not exists (select 1 from pgmq.q_server_call_delivery where vt<=clock_timestamp()) then
    return null;
  end if;
  select decrypted_secret into v_dispatch_secret from vault.decrypted_secrets where name='server_call_dispatch_secret' limit 1;
  select decrypted_secret into v_publishable_key from vault.decrypted_secrets where name='server_publishable_key' limit 1;
  if coalesce(v_dispatch_secret,'')='' or coalesce(v_publishable_key,'')='' then return null; end if;

  for v_worker in
    select * from public.server_call_delivery_claim_worker_slots(8,90)
  loop
    v_request_id:=net.http_post(
      url:='https://hzuovekqsjtpvmbuybxs.supabase.co/functions/v1/server-call-delivery-worker',
      body:=jsonb_build_object('trigger','worker-continuation','worker_slot',v_worker.slot_id,'worker_lease_id',v_worker.lease_id),
      headers:=jsonb_build_object('Content-Type','application/json','apikey',v_publishable_key,'x-server-dispatch-token',v_dispatch_secret),
      timeout_milliseconds:=10000
    );
  end loop;
  return v_request_id;
end;
$$;
revoke all on function public.server_call_delivery_kick_continuation() from public,anon,authenticated;
grant execute on function public.server_call_delivery_kick_continuation() to service_role;
