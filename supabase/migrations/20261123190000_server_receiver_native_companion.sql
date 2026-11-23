-- Native offline wake-up companion: one-time pairing and revocable native credentials.
create table if not exists public.server_receiver_native_pair_codes (
 id uuid primary key default gen_random_uuid(),
 receiver_device_id uuid not null references public.server_guest_push_devices(id) on delete cascade,
 pair_code_hash text not null unique check (pair_code_hash ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz not null,
 claimed_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists server_receiver_native_pair_codes_device_idx
 on public.server_receiver_native_pair_codes(receiver_device_id,created_at desc);
create table if not exists public.server_receiver_native_devices (
 id uuid primary key default gen_random_uuid(),
 receiver_device_id uuid not null references public.server_guest_push_devices(id) on delete cascade,
 native_secret_hash text not null unique check (native_secret_hash ~ '^[0-9a-f]{64}$'),
 last_seen_at timestamptz,
 revoked_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists server_receiver_native_devices_receiver_idx
 on public.server_receiver_native_devices(receiver_device_id) where revoked_at is null;
alter table public.server_receiver_native_pair_codes enable row level security;
alter table public.server_receiver_native_devices enable row level security;
revoke all on public.server_receiver_native_pair_codes from anon,authenticated;
revoke all on public.server_receiver_native_devices from anon,authenticated;
grant all on public.server_receiver_native_pair_codes to service_role;
grant all on public.server_receiver_native_devices to service_role;
comment on table public.server_receiver_native_pair_codes is
 'Single-use ten-minute pairing codes issued only to an already enrolled browser Receiver.';
comment on table public.server_receiver_native_devices is
 'Revocable Android companion credentials linked to an already enrolled browser Receiver.';
