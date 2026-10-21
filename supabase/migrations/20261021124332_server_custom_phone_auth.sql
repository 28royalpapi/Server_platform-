create extension if not exists pgcrypto with schema extensions;

select vault.create_secret(
  encode(extensions.gen_random_bytes(64),'hex'),
  'server_otp_pepper',
  'Private HMAC pepper for Server phone verification codes'
)
where not exists (select 1 from vault.decrypted_secrets where name='server_otp_pepper');

drop trigger if exists server_auth_user_profile_sync on auth.users;
drop function if exists public.server_handle_auth_user();

alter table public.server_profiles drop constraint if exists server_profiles_user_id_fkey;
alter table public.server_profiles alter column user_id set default gen_random_uuid();
alter table public.server_profiles add column if not exists phone_verified_at timestamptz;
alter table public.server_profiles alter column phone_e164 set not null;

alter table public.server_calls drop constraint if exists server_calls_caller_user_id_fkey;
alter table public.server_calls drop constraint if exists server_calls_callee_user_id_fkey;
alter table public.server_calls add constraint server_calls_caller_user_id_fkey
  foreign key (caller_user_id) references public.server_profiles(user_id) on delete cascade;
alter table public.server_calls add constraint server_calls_callee_user_id_fkey
  foreign key (callee_user_id) references public.server_profiles(user_id) on delete set null;

alter table public.server_call_members drop constraint if exists server_call_members_user_id_fkey;
alter table public.server_call_members add constraint server_call_members_user_id_fkey
  foreign key (user_id) references public.server_profiles(user_id) on delete cascade;

alter table public.server_call_signals drop constraint if exists server_call_signals_from_user_id_fkey;
alter table public.server_call_signals add constraint server_call_signals_from_user_id_fkey
  foreign key (from_user_id) references public.server_profiles(user_id) on delete cascade;

alter table public.server_sms_jobs drop constraint if exists server_sms_jobs_auth_user_id_fkey;
alter table public.server_sms_jobs add constraint server_sms_jobs_auth_user_id_fkey
  foreign key (auth_user_id) references public.server_profiles(user_id) on delete set null;

create table if not exists public.server_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  salt text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  consumed_at timestamptz,
  request_ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists server_otp_phone_recent_idx
  on public.server_otp_challenges(phone_e164,created_at desc);
create index if not exists server_otp_expiry_idx
  on public.server_otp_challenges(expires_at) where consumed_at is null;

create table if not exists public.server_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.server_profiles(user_id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  user_agent text
);
create index if not exists server_sessions_user_idx on public.server_sessions(user_id,expires_at desc);

create or replace function public.server_otp_hmac(p_phone text,p_code text,p_salt text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_pepper text;
begin
 select decrypted_secret into v_pepper
 from vault.decrypted_secrets where name='server_otp_pepper' limit 1;
 if v_pepper is null then raise exception 'otp_pepper_missing'; end if;
 return encode(extensions.hmac(convert_to(p_phone||':'||p_code||':'||p_salt,'UTF8'),convert_to(v_pepper,'UTF8'),'sha256'),'hex');
end; $$;
revoke all on function public.server_otp_hmac(text,text,text) from public,anon,authenticated;

create or replace function public.server_issue_otp(p_phone text,p_code text,p_ip_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_salt text; v_hash text; v_expires timestamptz; v_body text; v_device uuid;
begin
 if p_phone !~ '^\+[1-9][0-9]{7,14}$' or p_code !~ '^[0-9]{6}$' then
  return jsonb_build_object('status','INVALID_REQUEST');
 end if;
 if not public.server_rate_limit_allow('otp-phone',encode(extensions.digest(p_phone,'sha256'),'hex'),900,5)
    or not public.server_rate_limit_allow('otp-ip',coalesce(p_ip_hash,'unknown'),900,30) then
  return jsonb_build_object('status','RATE_LIMITED');
 end if;
 select id into v_device from public.server_gateway_devices
  where enabled=true and last_seen_at >= now()-interval '90 seconds'
  order by last_seen_at desc limit 1;
 if v_device is null then return jsonb_build_object('status','GATEWAY_OFFLINE'); end if;
 v_salt := encode(extensions.gen_random_bytes(16),'hex');
 v_hash := public.server_otp_hmac(p_phone,p_code,v_salt);
 v_expires := now()+interval '5 minutes';
 update public.server_otp_challenges set consumed_at=now()
  where phone_e164=p_phone and consumed_at is null;
 insert into public.server_otp_challenges(phone_e164,salt,code_hash,expires_at,request_ip_hash)
 values(p_phone,v_salt,v_hash,v_expires,coalesce(p_ip_hash,'unknown'));
 v_body := 'Your Server verification code is '||p_code||'. It expires in 5 minutes. Do not share this code.';
 insert into public.server_sms_jobs(category,recipient_e164,body,source_event_id,status)
 values('auth_otp',p_phone,v_body,'custom-otp:'||encode(extensions.digest(p_phone||':'||v_expires::text,'sha256'),'hex'),'queued');
 return jsonb_build_object('status','QUEUED','expires_at',v_expires);
end; $$;

create or replace function public.server_verify_otp(p_phone text,p_code text,p_ip_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_salt text; v_hash text; v_attempts integer; v_expires timestamptz;
begin
 if p_phone !~ '^\+[1-9][0-9]{7,14}$' or p_code !~ '^[0-9]{6}$' then
  return jsonb_build_object('status','INVALID');
 end if;
 if not public.server_rate_limit_allow('otp-verify-phone',encode(extensions.digest(p_phone,'sha256'),'hex'),900,10)
    or not public.server_rate_limit_allow('otp-verify-ip',coalesce(p_ip_hash,'unknown'),900,40) then
  return jsonb_build_object('status','RATE_LIMITED');
 end if;
 select id,salt,code_hash,attempts,expires_at into v_id,v_salt,v_hash,v_attempts,v_expires
  from public.server_otp_challenges
  where phone_e164=p_phone and consumed_at is null and expires_at>now()
  order by created_at desc limit 1 for update;
 if v_id is null then return jsonb_build_object('status','INVALID'); end if;
 if v_attempts>=5 then
  update public.server_otp_challenges set consumed_at=now() where id=v_id;
  return jsonb_build_object('status','INVALID');
 end if;
 if public.server_otp_hmac(p_phone,p_code,v_salt)<>v_hash then
  update public.server_otp_challenges set attempts=least(attempts+1,5),consumed_at=case when attempts+1>=5 then now() else consumed_at end where id=v_id;
  return jsonb_build_object('status','INVALID');
 end if;
 update public.server_otp_challenges set consumed_at=now() where id=v_id;
 return jsonb_build_object('status','VERIFIED','phone_e164',p_phone);
end; $$;

revoke all on function public.server_issue_otp(text,text,text) from public,anon,authenticated;
revoke all on function public.server_verify_otp(text,text,text) from public,anon,authenticated;
grant execute on function public.server_issue_otp(text,text,text) to service_role;
grant execute on function public.server_verify_otp(text,text,text) to service_role;

alter table public.server_otp_challenges enable row level security;
alter table public.server_sessions enable row level security;
revoke all on public.server_otp_challenges,public.server_sessions from anon,authenticated;
grant all on public.server_otp_challenges,public.server_sessions to service_role;
