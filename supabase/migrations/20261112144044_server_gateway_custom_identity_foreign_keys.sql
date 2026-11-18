-- Server accounts are custom device-first identities in public.server_profiles.
-- They are intentionally not Supabase Auth users; Gateway ownership must point
-- at the Server identity table so account-bound pairing can be created.
ALTER TABLE public.server_gateway_pairings
  DROP CONSTRAINT IF EXISTS server_gateway_pairings_owner_user_id_fkey;

ALTER TABLE public.server_gateway_devices
  DROP CONSTRAINT IF EXISTS server_gateway_devices_owner_user_id_fkey;

ALTER TABLE public.server_gateway_pairings
  ADD CONSTRAINT server_gateway_pairings_owner_user_id_fkey
  FOREIGN KEY (owner_user_id)
  REFERENCES public.server_profiles(user_id)
  ON DELETE CASCADE;

ALTER TABLE public.server_gateway_devices
  ADD CONSTRAINT server_gateway_devices_owner_user_id_fkey
  FOREIGN KEY (owner_user_id)
  REFERENCES public.server_profiles(user_id)
  ON DELETE CASCADE;
