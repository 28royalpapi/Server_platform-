-- One-app SMS gateway: persist the selected SIM and bind private SMS jobs
-- to the Server identity that owns that gateway. No phone-number/IMSI/ICCID data.
alter table public.server_gateway_devices
  add column if not exists sim_subscription_id integer,
  add column if not exists sim_slot_index integer,
  add column if not exists carrier_label text;

create index if not exists server_gateway_devices_owner_selected_idx
  on public.server_gateway_devices(owner_user_id, enabled, last_seen_at desc)
  where enabled = true;

create or replace function public.server_register_gateway_device(
  p_owner_user_id uuid,
  p_label text,
  p_token_hash text,
  p_subscription_id integer,
  p_slot_index integer,
  p_carrier_label text
)
returns table(id uuid, label text, enabled boolean, last_seen_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_owner_user_id is null
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_subscription_id is null or p_subscription_id < 0
     or p_slot_index is null or p_slot_index < 0 or p_slot_index > 7
     or nullif(btrim(p_carrier_label), '') is null then
    raise exception 'invalid_gateway_registration';
  end if;

  -- Replace the previous active gateway atomically for this Server identity.
  update public.server_gateway_devices d
     set enabled = false,
         shared_guest_sms_enabled = false,
         updated_at = now()
   where d.owner_user_id = p_owner_user_id
     and d.enabled = true;

  return query
  insert into public.server_gateway_devices(
    owner_user_id, label, token_hash, enabled, shared_guest_sms_enabled,
    sim_subscription_id, sim_slot_index, carrier_label, last_seen_at, updated_at
  )
  values(
    p_owner_user_id,
    left(btrim(p_label), 80),
    p_token_hash,
    true,
    false,
    p_subscription_id,
    p_slot_index,
    left(btrim(p_carrier_label), 80),
    null,
    now()
  )
  returning server_gateway_devices.id,
            server_gateway_devices.label,
            server_gateway_devices.enabled,
            server_gateway_devices.last_seen_at;
end;
$$;

revoke all on function public.server_register_gateway_device(uuid,text,text,integer,integer,text)
  from public, anon, authenticated;
grant execute on function public.server_register_gateway_device(uuid,text,text,integer,integer,text)
  to service_role;

-- OTP creation happens only after the Server identity exists. Bind each OTP to
-- that account's own freshly connected SIM Gateway; never use another user's SIM.
drop function if exists public.server_issue_otp(text, text, text);

create or replace function public.server_issue_otp(
  p_user_id uuid,
  p_phone text,
  p_code text,
  p_ip_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_salt text;
  v_hash text;
  v_expires timestamptz;
  v_body text;
  v_device uuid;
begin
  if p_user_id is null
     or p_phone !~ '^\\+[1-9][0-9]{7,14}$'
     or p_code !~ '^[0-9]{6}$' then
    return jsonb_build_object('status','INVALID_REQUEST');
  end if;

  if not public.server_rate_limit_allow(
       'otp-phone', encode(extensions.digest(p_user_id::text || ':' || p_phone,'sha256'),'hex'), 900, 5
     )
     or not public.server_rate_limit_allow('otp-ip', coalesce(p_ip_hash,'unknown'), 900, 30) then
    return jsonb_build_object('status','RATE_LIMITED');
  end if;

  select d.id into v_device
    from public.server_gateway_devices d
   where d.owner_user_id = p_user_id
     and d.enabled = true
     and d.last_seen_at >= now() - interval '90 seconds'
   order by d.last_seen_at desc
   limit 1;

  if v_device is null then
    return jsonb_build_object('status','GATEWAY_OFFLINE');
  end if;

  v_salt := encode(extensions.gen_random_bytes(16),'hex');
  v_hash := public.server_otp_hmac(p_phone,p_code,v_salt);
  v_expires := now() + interval '5 minutes';

  update public.server_otp_challenges
     set consumed_at = now()
   where phone_e164 = p_phone
     and consumed_at is null;

  insert into public.server_otp_challenges(
    phone_e164,salt,code_hash,expires_at,request_ip_hash
  )
  values(p_phone,v_salt,v_hash,v_expires,coalesce(p_ip_hash,'unknown'));

  v_body := 'Your Server verification code is ' || p_code ||
    '. It expires in 5 minutes. Do not share this code.';

  insert into public.server_sms_jobs(
    category,recipient_e164,body,auth_user_id,source_event_id,status
  )
  values(
    'auth_otp',p_phone,v_body,p_user_id,
    'custom-otp:' || encode(extensions.digest(p_user_id::text || ':' || p_phone || ':' || v_expires::text,'sha256'),'hex'),
    'queued'
  );

  return jsonb_build_object('status','QUEUED','expires_at',v_expires);
end;
$$;

revoke all on function public.server_issue_otp(uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.server_issue_otp(uuid,text,text,text)
  to service_role;

-- Private non-guest SMS belongs only to the gateway owner. Shared-gateway
-- consent is limited to guest invitations and never broadens OTP access.
create or replace function public.server_claim_sms_jobs(p_device_id uuid,p_limit integer default 3)
returns table(id uuid,recipient_e164 text,body text,category text,attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists(
    select 1 from public.server_gateway_devices d
     where d.id = p_device_id and d.enabled = true
  ) then
    raise exception 'gateway_not_authorized';
  end if;

  update public.server_sms_jobs j
     set status = 'failed',
         body = null,
         lease_until = null,
         error_code = 'GUEST_CALL_NOT_ACTIVE',
         updated_at = now()
   where j.category = 'guest_invite'
     and j.status = 'queued'
     and not exists(
       select 1
         from public.server_calls c
         join public.server_guest_invites gi on gi.id = j.guest_invite_id
        where c.id = j.call_id
          and c.state in ('ringing','connecting')
          and c.expires_at > now()
          and gi.expires_at > now()
          and gi.revoked_at is null
          and gi.joined_at is null
     );

  return query
  with picked as (
    select j.id
      from public.server_sms_jobs j
     where j.body is not null
       and (j.status = 'queued' or (j.status = 'leased' and j.lease_until < now()))
       and (
         (
           j.category <> 'guest_invite'
           and exists(
             select 1 from public.server_gateway_devices d
              where d.id = p_device_id
                and d.owner_user_id is not null
                and j.auth_user_id = d.owner_user_id
           )
         )
         or (
           j.category = 'guest_invite'
           and exists(
             select 1
               from public.server_calls c
               join public.server_gateway_devices d on d.id = p_device_id
               join public.server_guest_invites gi on gi.id = j.guest_invite_id
              where c.id = j.call_id
                and d.owner_user_id is not null
                and (c.caller_user_id = d.owner_user_id or d.shared_guest_sms_enabled = true)
                and gi.call_id = c.id
                and gi.phone_e164 = j.recipient_e164
                and c.state in ('ringing','connecting')
                and c.expires_at > now()
                and gi.expires_at > now()
                and gi.revoked_at is null
                and gi.joined_at is null
           )
         )
       )
     order by j.created_at
     for update skip locked
     limit greatest(1,least(coalesce(p_limit,3),5))
  )
  update public.server_sms_jobs j
     set status = 'leased',
         gateway_device_id = p_device_id,
         lease_until = now() + interval '90 seconds',
         attempts = j.attempts + 1,
         updated_at = now()
    from picked p
   where j.id = p.id
  returning j.id,j.recipient_e164,j.body,j.category,j.attempts;
end;
$$;

revoke all on function public.server_claim_sms_jobs(uuid,integer)
  from public, anon, authenticated;
grant execute on function public.server_claim_sms_jobs(uuid,integer)
  to service_role;
