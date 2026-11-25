-- Persistent, one-time Server Receiver enrolment.
-- The shared guest push registry remains the call-delivery source of truth.
create table if not exists public.server_receiver_invites (
 id uuid primary key default gen_random_uuid(),
 token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
 created_by_user_id uuid not null references public.server_profiles(user_id) on delete cascade,
 phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
 caller_label text not null check (length(caller_label) between 1 and 80),
 expires_at timestamptz not null,
 claimed_at timestamptz,
 claimed_endpoint_hash text check (claimed_endpoint_hash is null or claimed_endpoint_hash ~ '^[0-9a-f]{64}$'),
 revoked_at timestamptz,
 created_at timestamptz not null default now(),
 constraint server_receiver_claim_pair_check check (
  (claimed_at is null and claimed_endpoint_hash is null) or
  (claimed_at is not null and claimed_endpoint_hash is not null)
 )
);
create index if not exists server_receiver_invites_owner_created_idx
 on public.server_receiver_invites(created_by_user_id,created_at desc);
create index if not exists server_receiver_invites_phone_active_idx
 on public.server_receiver_invites(phone_e164,expires_at desc) where revoked_at is null;
alter table public.server_guest_push_devices
 add column if not exists receiver_secret_hash text
 check(receiver_secret_hash is null or receiver_secret_hash ~ '^[0-9a-f]{64}$');
alter table public.server_guest_push_devices
 add column if not exists receiver_invite_id uuid
 references public.server_receiver_invites(id) on delete set null;
create index if not exists server_guest_push_devices_receiver_invite_idx
 on public.server_guest_push_devices(receiver_invite_id) where receiver_invite_id is not null;
alter table public.server_receiver_invites enable row level security;
revoke all on public.server_receiver_invites from anon,authenticated;
grant all on public.server_receiver_invites to service_role;
comment on table public.server_receiver_invites is
 'One-use hashed invitations binding a destination phone number to an explicitly enrolled Server Web Push receiver.';
comment on column public.server_guest_push_devices.receiver_secret_hash is
 'Hashed per-browser secret used only to manage or revoke a persistent Server Receiver subscription.';
comment on column public.server_guest_push_devices.receiver_invite_id is
 'One-time Server Receiver invitation that registered this endpoint; null for legacy guest-call subscriptions.';
