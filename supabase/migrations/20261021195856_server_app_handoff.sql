-- Single-use, short-lived transfer from web onboarding to a native Server client.
create table if not exists public.server_app_handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.server_profiles(user_id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  created_user_agent text
);
create index if not exists server_app_handoffs_expiry_idx
  on public.server_app_handoffs(expires_at) where claimed_at is null;
alter table public.server_app_handoffs enable row level security;
revoke all on public.server_app_handoffs from anon, authenticated;
grant all on public.server_app_handoffs to service_role;
