-- Server device-first onboarding: no SMS OTP required to create a device identity.
-- SIM metadata is a user-selected preference, not proof of phone-number ownership.
alter table public.server_profiles
  alter column phone_e164 drop not null;

alter table public.server_profiles
  add column if not exists server_id text;

update public.server_profiles
set server_id = 'SVR-' || upper(encode(extensions.gen_random_bytes(5), 'hex'))
where server_id is null;

alter table public.server_profiles
  alter column server_id set default ('SVR-' || upper(encode(extensions.gen_random_bytes(5), 'hex')));

alter table public.server_profiles
  alter column server_id set not null;

create unique index if not exists server_profiles_server_id_uidx
  on public.server_profiles(server_id);

alter table public.server_calls
  alter column callee_phone_e164 drop not null;

create table if not exists public.server_device_identities (
  installation_id uuid primary key,
  secret_hash text not null,
  user_id uuid not null unique references public.server_profiles(user_id) on delete cascade,
  selected_sim_slot integer,
  selected_sim_carrier text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint server_device_selected_sim_slot_nonnegative
    check (selected_sim_slot is null or selected_sim_slot >= 0)
);

alter table public.server_device_identities enable row level security;
revoke all on public.server_device_identities from anon, authenticated;
grant all on public.server_device_identities to service_role;
