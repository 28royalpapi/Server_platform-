-- Bind each SIM gateway to the Server account that generated its one-time pairing code.
-- This prevents guest-call invitations from being sent through another user's SIM.
alter table public.server_gateway_pairings
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;
alter table public.server_gateway_devices
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

create index if not exists server_gateway_devices_owner_active_idx
  on public.server_gateway_devices(owner_user_id,last_seen_at desc)
  where enabled=true;
create index if not exists server_gateway_pairings_owner_expiry_idx
  on public.server_gateway_pairings(owner_user_id,expires_at)
  where claimed_at is null;
