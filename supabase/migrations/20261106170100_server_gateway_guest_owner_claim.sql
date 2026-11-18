create or replace function public.server_claim_sms_jobs(p_device_id uuid,p_limit integer default 3)
returns table(id uuid,recipient_e164 text,body text,category text,attempts integer)
language plpgsql security definer set search_path = '' as $$
begin
 if not exists(
   select 1 from public.server_gateway_devices d
   where d.id=p_device_id and d.enabled=true
 ) then
   raise exception 'gateway_not_authorized';
 end if;
 return query
 with picked as (
   select j.id
   from public.server_sms_jobs j
   where j.body is not null
     and (j.status='queued' or (j.status='leased' and j.lease_until<now()))
     and (
       j.category <> 'guest_invite'
       or exists(
         select 1
         from public.server_calls c
         join public.server_gateway_devices d on d.id=p_device_id
         where c.id=j.call_id
           and c.caller_user_id=d.owner_user_id
           and d.owner_user_id is not null
       )
     )
   order by j.created_at
   for update skip locked
   limit greatest(1,least(coalesce(p_limit,3),5))
 )
 update public.server_sms_jobs j
 set status='leased',gateway_device_id=p_device_id,
     lease_until=now()+interval '90 seconds',
     attempts=j.attempts+1,updated_at=now()
 from picked p
 where j.id=p.id
 returning j.id,j.recipient_e164,j.body,j.category,j.attempts;
end;
$$;
revoke all on function public.server_claim_sms_jobs(uuid,integer) from public,anon,authenticated;
grant execute on function public.server_claim_sms_jobs(uuid,integer) to service_role;
