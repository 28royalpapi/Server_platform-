alter table public.server_profiles
  add column if not exists allow_number_based_server_calls boolean not null default false;

comment on column public.server_profiles.allow_number_based_server_calls is
  'Explicit opt-in for routing calls from other Server users to this profile by its verified phone number through Server internet calling. This does not redirect ordinary carrier/PSTN calls.';
