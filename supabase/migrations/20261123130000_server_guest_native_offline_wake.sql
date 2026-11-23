-- Native Android offline wake registration for the existing one-time Receiver link.
-- The native companion stores only the inviting caller's verified number locally;
-- the backend stores hashes for device credentials and the receiver/caller binding.
create table if not exists public.server_guest_native_wake_devices (
  id uuid primary key default gen_random_uuid(),
  receiver_invite_id uuid not null unique
    references public.server_receiver_invites(id) on delete cascade,
  recipient_phone_e164 text not null
    check (recipient_phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  caller_user_id uuid not null
    references public.server_profiles(user_id) on delete cascade,
  caller_phone_e164 text not null
    check (caller_phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  caller_server_id text not null,
  caller_label text not null check (length(caller_label) between 1 and 80),
  device_id_hash text not null check (device_id_hash ~ '^[0-9a-f]{64}$'),
  device_secret_hash text not null check (device_secret_hash ~ '^[0-9a-f]{64}$'),
  call_screening_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists server_guest_native_wake_phone_active_idx
  on public.server_guest_native_wake_devices(recipient_phone_e164, caller_phone_e164)
  where revoked_at is null and call_screening_enabled = true;
create index if not exists server_guest_native_wake_owner_idx
  on public.server_guest_native_wake_devices(caller_user_id, created_at desc)
  where revoked_at is null;
alter table public.server_guest_native_wake_devices enable row level security;
revoke all on public.server_guest_native_wake_devices from anon, authenticated;
grant all on public.server_guest_native_wake_devices to service_role;
comment on table public.server_guest_native_wake_devices is
  'Opt-in Android Receiver companion registrations for offline cellular wake signalling; no SMS provider or carrier message is used.';
comment on column public.server_guest_native_wake_devices.device_secret_hash is
  'SHA-256 of the app-private native Receiver credential; plaintext credential remains on the handset.';
