-- Guest browser call-alert schema and private VAPID key storage.
-- The browser subscription is bound to the E.164 number carried by the invitation.
create table if not exists public.server_guest_push_devices (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  expiration_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists server_guest_push_devices_phone_live_idx
  on public.server_guest_push_devices(phone_e164, last_seen_at desc)
  where revoked_at is null;
alter table public.server_guest_push_devices enable row level security;
revoke all on public.server_guest_push_devices from anon, authenticated;
grant all on public.server_guest_push_devices to service_role;

-- A single VAPID keypair for this Server installation. The private key is never returned to browsers.
create table if not exists public.server_guest_push_config (
  id smallint primary key check (id = 1),
  subject text not null,
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.server_guest_push_config enable row level security;
revoke all on public.server_guest_push_config from anon, authenticated;
grant all on public.server_guest_push_config to service_role;
