-- Server uses its own server_profiles/server_sessions identity model,
-- not Supabase Auth users. Push endpoints must reference the same identity
-- used by Server call membership and session rows.
alter table public.server_push_devices
  drop constraint if exists server_push_devices_user_id_fkey;

alter table public.server_push_devices
  add constraint server_push_devices_user_id_fkey
  foreign key (user_id)
  references public.server_profiles(user_id)
  on delete cascade;

create index if not exists server_push_devices_user_platform_idx
  on public.server_push_devices(user_id,platform);
