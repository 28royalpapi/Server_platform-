-- Pending Server Receiver links remain valid until used or explicitly revoked.
-- Keep already-expired links expired; extend only still-valid pending links.
alter table public.server_receiver_invites
  alter column expires_at drop not null;

update public.server_receiver_invites
   set expires_at = null
 where revoked_at is null
   and claimed_at is null
   and expires_at > now();

comment on column public.server_receiver_invites.expires_at is
  'NULL means a one-use pending invitation has no time-based expiry; it remains valid until claimed or revoked.';
