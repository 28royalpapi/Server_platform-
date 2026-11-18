alter table public.server_profiles
  add column if not exists display_name text;

alter table public.server_profiles
  drop constraint if exists server_profiles_display_name_length_check;

alter table public.server_profiles
  add constraint server_profiles_display_name_length_check
  check (display_name is null or char_length(display_name) between 2 and 60);

comment on column public.server_profiles.display_name is
  'User-chosen caller identity shown in Server call previews, notifications and call screens; not independently identity-verified.';
