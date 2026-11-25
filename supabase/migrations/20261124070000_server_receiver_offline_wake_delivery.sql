-- Persist the last native offline-wake readiness check and speed up active guest-call lookup.
alter table public.server_receiver_native_devices
  add column if not exists ready_at timestamptz;

create index if not exists server_receiver_native_devices_ready_idx
  on public.server_receiver_native_devices (receiver_device_id, ready_at desc)
  where revoked_at is null and ready_at is not null;

create index if not exists server_calls_guest_receiver_lookup_idx
  on public.server_calls (callee_phone_e164, created_at desc)
  where route = 'guest' and state in ('ringing', 'connecting');

comment on column public.server_receiver_native_devices.ready_at is
  'Most recent explicit confirmation that Android Call Screening role and required Receiver permissions are enabled.';
