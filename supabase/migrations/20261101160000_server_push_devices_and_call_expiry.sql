-- Service-role-only push endpoints and finite live-call invitations.
create table if not exists public.server_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('android','ios_voip')),
  token text not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(platform, token)
);
create index if not exists server_push_devices_user_platform_idx
  on public.server_push_devices(user_id, platform);
alter table public.server_calls add column if not exists expires_at timestamptz;
create index if not exists server_calls_ringing_expiry_idx
  on public.server_calls(state, expires_at) where state = 'ringing';
alter table public.server_push_devices enable row level security;
revoke all on public.server_push_devices from anon, authenticated;
grant all on public.server_push_devices to service_role;
