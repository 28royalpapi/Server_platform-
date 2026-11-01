-- Guest browser endpoints are enrolled with an unexpired, one-time invitation link.
create table if not exists public.server_guest_push_devices (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null check (phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  token text not null unique,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists server_guest_push_devices_phone_idx
  on public.server_guest_push_devices(phone_e164);
alter table public.server_guest_push_devices enable row level security;
revoke all on public.server_guest_push_devices from anon, authenticated;
grant all on public.server_guest_push_devices to service_role;
