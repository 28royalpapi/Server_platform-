-- Browser guests can receive internet call alerts without a Server account or native app.
-- A guest explicitly subscribes from a one-time invitation link; only the service role can read endpoints/keys.
create table if not exists public.server_guest_push_devices (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null check (phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  expiration_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.server_guest_push_devices drop column if exists token;
alter table public.server_guest_push_devices add column if not exists endpoint text;
alter table public.server_guest_push_devices add column if not exists p256dh text;
alter table public.server_guest_push_devices add column if not exists auth text;
alter table public.server_guest_push_devices add column if not exists expiration_at timestamptz;
alter table public.server_guest_push_devices add column if not exists last_seen_at timestamptz not null default now();
alter table public.server_guest_push_devices add column if not exists updated_at timestamptz not null default now();
alter table public.server_guest_push_devices add column if not exists revoked_at timestamptz;
create unique index if not exists server_guest_push_devices_endpoint_uidx
  on public.server_guest_push_devices(endpoint) where endpoint is not null;
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
