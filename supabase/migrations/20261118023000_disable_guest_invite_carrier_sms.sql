-- Guest invitations are internet notifications or manually shared secure links.
-- Never allow a guest invitation into the Android SmsManager carrier-SMS queue.
-- Carrier SMS can consume the Server-funded SIM bundle and is not a free transport.
update public.server_sms_jobs
   set status = 'failed',
       body = null,
       gateway_device_id = null,
       lease_until = null,
       error_code = 'CARRIER_SMS_DISABLED_USE_WEB_PUSH',
       updated_at = now()
 where category = 'guest_invite'
   and status in ('queued','leased');

create or replace function public.server_claim_sms_jobs(
  p_device_id uuid,
  p_limit integer default 50
)
returns table(id uuid,recipient_e164 text,body text,category text,attempts integer)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Only a Server-operated, Server-funded handset can claim the remaining
  -- carrier-SMS workflows (for example, phone-verification OTP).
  if not exists(
    select 1 from public.server_gateway_devices d
     where d.id = p_device_id
       and d.enabled = true
       and d.is_platform_owned = true
  ) then
    raise exception 'platform_gateway_not_authorized';
  end if;

  -- Defensive cleanup for any guest invitation created by an older function.
  update public.server_sms_jobs j
     set status = 'failed',
         body = null,
         gateway_device_id = null,
         lease_until = null,
         error_code = 'CARRIER_SMS_DISABLED_USE_WEB_PUSH',
         updated_at = now()
   where j.category = 'guest_invite'
     and j.status in ('queued','leased');

  return query
  with picked as (
    select j.id
      from public.server_sms_jobs j
     where j.category = 'auth_otp'
       and j.body is not null
       and (
         j.status = 'queued'
         or (j.status = 'leased' and j.lease_until < now())
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
$function$;

revoke all on function public.server_claim_sms_jobs(uuid,integer)
  from public, anon, authenticated;
grant execute on function public.server_claim_sms_jobs(uuid,integer)
  to service_role;

comment on function public.server_claim_sms_jobs(uuid,integer) is
  'Server-owned carrier SMS worker. Claims auth_otp only; guest_invite is always non-carrier Web Push/share.';
