-- SMS costs are borne by Server, never by a customer's personal SIM.
-- Existing customer gateways remain registered but cannot claim any SMS jobs
-- unless an operator explicitly marks a Server-owned handset as platform-owned.
alter table public.server_gateway_devices
  add column if not exists is_platform_owned boolean not null default false;

create index if not exists server_gateway_devices_platform_active_idx
  on public.server_gateway_devices(last_seen_at desc)
  where enabled = true and is_platform_owned = true;

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
   where d.is_platform_owned = true
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

create or replace function public.server_claim_sms_jobs(
  p_device_id uuid,
  p_limit integer default 50
)
returns table(id uuid,recipient_e164 text,body text,category text,attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only gateways explicitly designated as Server-operated hardware may send
  -- any Server SMS. Customer-owned SIM devices cannot claim messages.
  if not exists(
    select 1 from public.server_gateway_devices d
     where d.id = p_device_id
       and d.enabled = true
       and d.is_platform_owned = true
  ) then
    raise exception 'platform_gateway_not_authorized';
  end if;

  -- Never send a guest invitation after its call/invite has expired or been answered.
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
       and (
         j.status = 'queued'
         or (j.status = 'leased' and j.lease_until < now())
       )
       and (
         j.category <> 'guest_invite'
         or exists(
           select 1
             from public.server_calls c
             join public.server_guest_invites gi on gi.id = j.guest_invite_id
            where c.id = j.call_id
              and gi.call_id = c.id
              and gi.phone_e164 = j.recipient_e164
              and c.state in ('ringing','connecting')
              and c.expires_at > now()
              and gi.expires_at > now()
              and gi.revoked_at is null
              and gi.joined_at is null
         )
       )
     order by j.created_at
     for update skip locked
     limit greatest(1,least(coalesce(p_limit,50),100))
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
