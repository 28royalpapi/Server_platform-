-- Reliable Server presence: active authenticated listener vs background push candidate.
-- Presence is based on a throttled session heartbeat, not on session expiry alone.
create index if not exists server_sessions_user_presence_idx
  on public.server_sessions(user_id,last_seen_at desc,expires_at desc)
  where revoked_at is null;

create or replace function public.server_recipient_availability(
  p_user_id uuid,
  p_fresh_seconds integer default 35
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last_seen timestamptz;
  v_has_push boolean;
begin
  if p_user_id is null then
    raise exception 'RECIPIENT_USER_REQUIRED' using errcode='22023';
  end if;

  select max(s.last_seen_at)
    into v_last_seen
    from public.server_sessions s
   where s.user_id=p_user_id
     and s.revoked_at is null
     and s.expires_at>clock_timestamp()
     and s.last_seen_at>clock_timestamp()-make_interval(secs=>greatest(15,least(90,coalesce(p_fresh_seconds,35))));

  if v_last_seen is not null then
    return jsonb_build_object(
      'status','online',
      'last_seen_at',v_last_seen,
      'background_wake_possible',true
    );
  end if;

  select exists(
    select 1 from public.server_push_devices d where d.user_id=p_user_id
  ) into v_has_push;

  if v_has_push then
    return jsonb_build_object(
      'status','background_reachable',
      'last_seen_at',null,
      'background_wake_possible',true
    );
  end if;

  return jsonb_build_object(
    'status','offline',
    'last_seen_at',null,
    'background_wake_possible',false
  );
end;
$$;
revoke all on function public.server_recipient_availability(uuid,integer) from public,anon,authenticated;
grant execute on function public.server_recipient_availability(uuid,integer) to service_role;
