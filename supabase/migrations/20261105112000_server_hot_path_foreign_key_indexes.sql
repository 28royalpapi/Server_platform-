-- Cover lookup and cascade paths which become expensive as call history grows.
create index if not exists server_call_members_user_call_idx
  on public.server_call_members(user_id,call_id);

create index if not exists server_call_signals_from_user_idx
  on public.server_call_signals(from_user_id)
  where from_user_id is not null;

create index if not exists server_call_signals_from_guest_invite_idx
  on public.server_call_signals(from_guest_invite_id)
  where from_guest_invite_id is not null;

create index if not exists server_sms_jobs_auth_user_id_idx
  on public.server_sms_jobs(auth_user_id)
  where auth_user_id is not null;

create index if not exists server_sms_jobs_call_id_idx
  on public.server_sms_jobs(call_id)
  where call_id is not null;

create index if not exists server_sms_jobs_gateway_device_id_idx
  on public.server_sms_jobs(gateway_device_id)
  where gateway_device_id is not null;

create index if not exists server_sms_jobs_guest_invite_id_idx
  on public.server_sms_jobs(guest_invite_id)
  where guest_invite_id is not null;

create index if not exists server_app_handoffs_user_id_idx
  on public.server_app_handoffs(user_id);
