-- Create a call and all required participant/invitation rows atomically.
-- Edge Functions call this through the service-role client; callers cannot invoke it.
create or replace function public.server_create_call_atomic(
  p_caller_user_id uuid,
  p_callee_user_id uuid,
  p_callee_phone_e164 text,
  p_route text,
  p_expires_at timestamptz,
  p_invite_phone_e164 text default null,
  p_invite_token_hash text default null,
  p_invite_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.server_calls%rowtype;
  v_invite_id uuid := null;
  v_now timestamptz := now();
begin
  if p_caller_user_id is null then
    raise exception 'CALLER_REQUIRED' using errcode='22023';
  end if;
  if p_route not in ('server','guest') then
    raise exception 'INVALID_CALL_ROUTE' using errcode='22023';
  end if;
  if p_expires_at is null or p_expires_at <= v_now then
    raise exception 'INVALID_CALL_EXPIRY' using errcode='22023';
  end if;

  if p_route='server' then
    if p_callee_user_id is null or p_callee_user_id=p_caller_user_id then
      raise exception 'INVALID_SERVER_CALLEE' using errcode='22023';
    end if;
    if p_invite_phone_e164 is not null or p_invite_token_hash is not null or p_invite_expires_at is not null then
      raise exception 'UNEXPECTED_GUEST_INVITE' using errcode='22023';
    end if;
  else
    if p_callee_user_id is not null
      or p_invite_phone_e164 is null
      or p_invite_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
      or p_invite_token_hash is null
      or p_invite_token_hash !~ '^[0-9a-f]{64}$'
      or p_invite_expires_at is null
      or p_invite_expires_at <= v_now then
      raise exception 'INVALID_GUEST_INVITE' using errcode='22023';
    end if;
  end if;

  insert into public.server_calls (
    caller_user_id, callee_user_id, callee_phone_e164,
    route, state, created_at, updated_at, expires_at
  )
  values (
    p_caller_user_id, p_callee_user_id, p_callee_phone_e164,
    p_route, 'ringing', v_now, v_now, p_expires_at
  )
  returning * into v_call;

  insert into public.server_call_members (call_id,user_id,member_role)
  values (v_call.id,p_caller_user_id,'caller');

  if p_route='server' then
    insert into public.server_call_members (call_id,user_id,member_role)
    values (v_call.id,p_callee_user_id,'callee');
  else
    insert into public.server_guest_invites (
      call_id,phone_e164,token_hash,expires_at
    )
    values (
      v_call.id,p_invite_phone_e164,p_invite_token_hash,p_invite_expires_at
    )
    returning id into v_invite_id;
  end if;

  return jsonb_build_object(
    'call',jsonb_build_object(
      'id',v_call.id,
      'state',v_call.state,
      'route',v_call.route,
      'created_at',v_call.created_at,
      'updated_at',v_call.updated_at,
      'expires_at',v_call.expires_at
    ),
    'invite_id',v_invite_id
  );
end;
$$;

revoke all on function public.server_create_call_atomic(
  uuid,uuid,text,text,timestamptz,text,text,timestamptz
) from public,anon,authenticated;
grant execute on function public.server_create_call_atomic(
  uuid,uuid,text,text,timestamptz,text,text,timestamptz
) to service_role;
