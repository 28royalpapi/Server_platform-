create extension if not exists pgcrypto;

create table public.server_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 phone_e164 text unique check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
 created_at timestamptz not null default now(),
 accepted_terms_version text, accepted_privacy_version text, accepted_legal_at timestamptz,
 notifications_enabled boolean not null default true,
 contacts_access_requested boolean not null default false,
 updated_at timestamptz not null default now()
);
create table public.server_gateway_devices (
 id uuid primary key default gen_random_uuid(), label text not null default 'Server SIM Gateway',
 token_hash text not null unique, enabled boolean not null default true,
 last_seen_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.server_gateway_pairings (
 id uuid primary key default gen_random_uuid(), code_hash text not null unique,
 expires_at timestamptz not null, claimed_at timestamptz, created_at timestamptz not null default now()
);
create table public.server_calls (
 id uuid primary key default gen_random_uuid(),
 caller_user_id uuid not null references auth.users(id) on delete cascade,
 callee_user_id uuid references auth.users(id) on delete set null,
 callee_phone_e164 text not null check (callee_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
 route text not null check (route in ('server','guest')),
 state text not null default 'ringing' check (state in ('ringing','connecting','active','ended','missed','failed')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), ended_at timestamptz
);
create table public.server_call_members (
 call_id uuid not null references public.server_calls(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 member_role text not null check (member_role in ('caller','callee')),
 joined_at timestamptz, left_at timestamptz, created_at timestamptz not null default now(),
 primary key(call_id,user_id)
);
create table public.server_guest_invites (
 id uuid primary key default gen_random_uuid(), call_id uuid not null references public.server_calls(id) on delete cascade,
 phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
 token_hash text not null unique, expires_at timestamptz not null, joined_at timestamptz, revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.server_call_signals (
 seq bigserial primary key, call_id uuid not null references public.server_calls(id) on delete cascade,
 from_user_id uuid references auth.users(id) on delete cascade,
 from_guest_invite_id uuid references public.server_guest_invites(id) on delete cascade,
 kind text not null check (kind in ('offer','answer','ice','hangup','state')),
 payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
 check ((from_user_id is not null and from_guest_invite_id is null) or (from_user_id is null and from_guest_invite_id is not null)),
 check (octet_length(payload::text) <= 20000)
);
create table public.server_sms_jobs (
 id uuid primary key default gen_random_uuid(),
 category text not null check (category in ('auth_otp','guest_invite','notification')),
 recipient_e164 text not null check (recipient_e164 ~ '^\+[1-9][0-9]{7,14}$'),
 body text, auth_user_id uuid references auth.users(id) on delete set null,
 call_id uuid references public.server_calls(id) on delete set null,
 guest_invite_id uuid references public.server_guest_invites(id) on delete set null,
 source_event_id text unique, status text not null default 'queued' check (status in ('queued','leased','sent','delivered','failed')),
 gateway_device_id uuid references public.server_gateway_devices(id) on delete set null,
 lease_until timestamptz, attempts integer not null default 0 check (attempts >= 0),
 error_code text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 sent_at timestamptz, delivered_at timestamptz
);
create index server_sms_jobs_claim_idx on public.server_sms_jobs(status,created_at) where status in ('queued','leased');
create index server_calls_callee_idx on public.server_calls(callee_user_id,state,created_at desc);
create index server_calls_caller_idx on public.server_calls(caller_user_id,created_at desc);
create index server_guest_invites_call_idx on public.server_guest_invites(call_id);
create index server_call_signals_poll_idx on public.server_call_signals(call_id,seq);
create table public.server_rate_limits (
 scope text not null, key_hash text not null, window_started_at timestamptz not null default now(),
 hit_count integer not null default 0, primary key(scope,key_hash)
);
create or replace function public.server_handle_auth_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.server_profiles(user_id,phone_e164)
 values(new.id,case when new.phone_confirmed_at is not null then nullif(new.phone,'') else null end)
 on conflict(user_id) do update set phone_e164=excluded.phone_e164,updated_at=now();
 return new;
end; $$;
revoke all on function public.server_handle_auth_user() from public,anon,authenticated;
create trigger server_auth_user_profile_sync after insert or update of phone,phone_confirmed_at on auth.users for each row execute function public.server_handle_auth_user();
insert into public.server_profiles(user_id,phone_e164)
select id,case when phone_confirmed_at is not null then nullif(phone,'') else null end from auth.users
on conflict(user_id) do update set phone_e164=excluded.phone_e164,updated_at=now();
create or replace function public.server_rate_limit_allow(p_scope text,p_key_hash text,p_window_seconds integer,p_max_hits integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_hits integer;
begin
 if p_window_seconds < 1 or p_max_hits < 1 then return false; end if;
 insert into public.server_rate_limits(scope,key_hash,window_started_at,hit_count) values(p_scope,p_key_hash,now(),1)
 on conflict(scope,key_hash) do update set
 window_started_at=case when public.server_rate_limits.window_started_at <= now()-make_interval(secs=>p_window_seconds) then now() else public.server_rate_limits.window_started_at end,
 hit_count=case when public.server_rate_limits.window_started_at <= now()-make_interval(secs=>p_window_seconds) then 1 else public.server_rate_limits.hit_count+1 end
 returning hit_count into v_hits;
 return v_hits <= p_max_hits;
end; $$;
create or replace function public.server_claim_sms_jobs(p_device_id uuid,p_limit integer default 3)
returns table(id uuid,recipient_e164 text,body text,category text,attempts integer)
language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from public.server_gateway_devices d where d.id=p_device_id and d.enabled=true) then raise exception 'gateway_not_authorized'; end if;
 return query with picked as (select j.id from public.server_sms_jobs j where j.body is not null and (j.status='queued' or (j.status='leased' and j.lease_until<now())) order by j.created_at for update skip locked limit greatest(1,least(coalesce(p_limit,3),5)))
 update public.server_sms_jobs j set status='leased',gateway_device_id=p_device_id,lease_until=now()+interval '90 seconds',attempts=j.attempts+1,updated_at=now()
 from picked p where j.id=p.id returning j.id,j.recipient_e164,j.body,j.category,j.attempts;
end; $$;
revoke all on function public.server_rate_limit_allow(text,text,integer,integer) from public,anon,authenticated;
revoke all on function public.server_claim_sms_jobs(uuid,integer) from public,anon,authenticated;
grant execute on function public.server_rate_limit_allow(text,text,integer,integer) to service_role;
grant execute on function public.server_claim_sms_jobs(uuid,integer) to service_role;
alter table public.server_profiles enable row level security;
alter table public.server_gateway_devices enable row level security;
alter table public.server_gateway_pairings enable row level security;
alter table public.server_sms_jobs enable row level security;
alter table public.server_calls enable row level security;
alter table public.server_call_members enable row level security;
alter table public.server_guest_invites enable row level security;
alter table public.server_call_signals enable row level security;
alter table public.server_rate_limits enable row level security;
revoke all on public.server_profiles,public.server_gateway_devices,public.server_gateway_pairings,public.server_sms_jobs,public.server_calls,public.server_call_members,public.server_guest_invites,public.server_call_signals,public.server_rate_limits from anon,authenticated;
grant all on public.server_profiles,public.server_gateway_devices,public.server_gateway_pairings,public.server_sms_jobs,public.server_calls,public.server_call_members,public.server_guest_invites,public.server_call_signals,public.server_rate_limits to service_role;
grant usage,select on sequence public.server_call_signals_seq_seq to service_role;
