-- Atomically commit call state changes and their signalling events.
-- These functions are service-role-only RPCs used by Server Edge Functions.
create or replace function public.server_guest_transition_atomic(
  p_invite_id uuid,p_action text,p_kind text default null,p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_invite public.server_guest_invites%rowtype;
  v_call public.server_calls%rowtype;
  v_signal public.server_call_signals%rowtype;
  v_kind text := case when p_action='leave' then 'hangup' else p_kind end;
  v_payload jsonb := coalesce(p_payload,'{}'::jsonb);
  v_now timestamptz := clock_timestamp();
begin
  if p_invite_id is null or p_action not in ('join','decline','signal','leave') then
    return jsonb_build_object('error','INVALID_GUEST_TRANSITION');
  end if;
  select * into v_invite from public.server_guest_invites
   where id=p_invite_id and revoked_at is null and expires_at>v_now for update;
  if not found then return jsonb_build_object('error','GUEST_INVITE_EXPIRED_OR_INVALID'); end if;
  select * into v_call from public.server_calls where id=v_invite.call_id for update;
  if not found or v_call.route<>'guest' then return jsonb_build_object('error','CALL_NOT_FOUND'); end if;

  if v_call.state in ('ringing','connecting') and v_call.expires_at is not null and v_call.expires_at<=v_now then
    update public.server_calls set state='missed',ended_at=v_now,updated_at=v_now
     where id=v_call.id and state in ('ringing','connecting') returning * into v_call;
    return jsonb_build_object('error','CALL_NOT_ANSWERABLE','state',coalesce(v_call.state,'missed'));
  end if;

  if p_action='join' then
    if v_call.state not in ('ringing','connecting') then return jsonb_build_object('error','CALL_NOT_ANSWERABLE','state',v_call.state); end if;
    update public.server_guest_invites set joined_at=coalesce(joined_at,v_now)
     where id=v_invite.id returning * into v_invite;
    if not found then return jsonb_build_object('error','INVITE_JOIN_FAILED'); end if;
    update public.server_calls set state='connecting',updated_at=v_now
     where id=v_call.id and state in ('ringing','connecting') returning * into v_call;
    if not found then return jsonb_build_object('error','CALL_NOT_ANSWERABLE'); end if;
    return jsonb_build_object('ok',true,'state',v_call.state,'invite_id',v_invite.id,
      'call',jsonb_build_object('id',v_call.id,'state',v_call.state,'route',v_call.route,
        'created_at',v_call.created_at,'updated_at',v_call.updated_at,'expires_at',v_call.expires_at));
  end if;

  if p_action='decline' then
    if v_call.state not in ('ringing','connecting') then return jsonb_build_object('error','CALL_NOT_ANSWERABLE','state',v_call.state); end if;
    update public.server_calls set state='ended',ended_at=v_now,updated_at=v_now
     where id=v_call.id and state in ('ringing','connecting') returning * into v_call;
    if not found then return jsonb_build_object('error','CALL_NOT_ANSWERABLE'); end if;
    insert into public.server_call_signals(call_id,from_guest_invite_id,kind,payload)
    values(v_call.id,v_invite.id,'hangup',jsonb_build_object('reason','declined')) returning * into v_signal;
    return jsonb_build_object('ok',true,'state','ended','seq',v_signal.seq,'created_at',v_signal.created_at);
  end if;

  if v_invite.joined_at is null then return jsonb_build_object('error','JOIN_REQUIRED'); end if;
  if v_kind not in ('offer','answer','ice','hangup','state') then return jsonb_build_object('error','INVALID_SIGNAL'); end if;
  if jsonb_typeof(v_payload)<>'object' then return jsonb_build_object('error','INVALID_SIGNAL'); end if;
  if octet_length(v_payload::text)>18000 then return jsonb_build_object('error','PAYLOAD_TOO_LARGE'); end if;
  if v_call.state not in ('ringing','connecting','active') then return jsonb_build_object('error','CALL_NOT_ANSWERABLE','state',v_call.state); end if;

  if v_kind='hangup' then
    update public.server_calls set state='ended',ended_at=v_now,updated_at=v_now
     where id=v_call.id and state in ('ringing','connecting','active') returning * into v_call;
  elsif v_kind in ('offer','answer') then
    update public.server_calls set state='connecting',updated_at=v_now
     where id=v_call.id and state in ('ringing','connecting') returning * into v_call;
  elsif v_kind='state' and v_payload->>'state'='active' then
    update public.server_calls set state='active',updated_at=v_now
     where id=v_call.id and state in ('ringing','connecting','active') returning * into v_call;
  end if;
  insert into public.server_call_signals(call_id,from_guest_invite_id,kind,payload)
  values(v_call.id,v_invite.id,v_kind,v_payload) returning * into v_signal;
  return jsonb_build_object('ok',true,'seq',v_signal.seq,'created_at',v_signal.created_at,'state',v_call.state);
end;
$$;
revoke all on function public.server_guest_transition_atomic(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.server_guest_transition_atomic(uuid,text,text,jsonb) to service_role;

create or replace function public.server_call_transition_atomic(
  p_call_id uuid,p_user_id uuid,p_action text,p_kind text default null,p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_call public.server_calls%rowtype;
  v_signal public.server_call_signals%rowtype;
  v_role text;
  v_payload jsonb := coalesce(p_payload,'{}'::jsonb);
  v_now timestamptz := clock_timestamp();
begin
  if p_call_id is null or p_user_id is null or p_action not in ('answer','end','set_active','signal') then
    return jsonb_build_object('error','INVALID_CALL_TRANSITION');
  end if;
  select member_role into v_role from public.server_call_members where call_id=p_call_id and user_id=p_user_id;
  if not found then return jsonb_build_object('error','CALL_ACCESS_DENIED'); end if;
  select * into v_call from public.server_calls where id=p_call_id for update;
  if not found then return jsonb_build_object('error','CALL_NOT_FOUND'); end if;

  if v_call.state in ('ended','missed','failed') then
    if p_action='end' or (p_action='signal' and p_kind='hangup') then
      return jsonb_build_object('ok',true,'state',v_call.state,'already_ended',true);
    end if;
    return jsonb_build_object('error','CALL_NOT_ANSWERABLE','state',v_call.state);
  end if;
  if v_call.state in ('ringing','connecting') and v_call.expires_at is not null and v_call.expires_at<=v_now then
    update public.server_calls set state='missed',ended_at=v_now,updated_at=v_now
     where id=v_call.id and state in ('ringing','connecting');
    return jsonb_build_object('error','CALL_NOT_ANSWERABLE','state','missed');
  end if;

  if p_action='answer' then
    if v_role<>'callee' or v_call.state not in ('ringing','connecting') then
      return jsonb_build_object('error','CALL_NOT_ANSWERABLE','state',v_call.state);
    end if;
    update public.server_calls set state='connecting',updated_at=v_now
     where id=v_call.id and state in ('ringing','connecting') returning * into v_call;
    if not found then return jsonb_build_object('error','CALL_NOT_ANSWERABLE'); end if;
    update public.server_call_members set joined_at=coalesce(joined_at,v_now)
     where call_id=v_call.id and user_id=p_user_id;
    return jsonb_build_object('ok',true,'state',v_call.state,'call',
      jsonb_build_object('id',v_call.id,'state',v_call.state,'route',v_call.route,
        'created_at',v_call.created_at,'updated_at',v_call.updated_at,'expires_at',v_call.expires_at));
  end if;

  if p_action='set_active' then
    if v_call.state not in ('ringing','connecting','active') then return jsonb_build_object('error','CALL_NOT_ANSWERABLE','state',v_call.state); end if;
    update public.server_calls set state='active',updated_at=v_now
     where id=v_call.id and state in ('ringing','connecting','active') returning * into v_call;
    update public.server_call_members set joined_at=coalesce(joined_at,v_now)
     where call_id=v_call.id and user_id=p_user_id;
    return jsonb_build_object('ok',true,'state','active');
  end if;

  if p_action='end' then
    update public.server_calls set state='ended',ended_at=v_now,updated_at=v_now
     where id=v_call.id and state in ('ringing','connecting','active') returning * into v_call;
    if not found then return jsonb_build_object('ok',true,'state',v_call.state,'already_ended',true); end if;
    insert into public.server_call_signals(call_id,from_user_id,kind,payload)
    values(v_call.id,p_user_id,'hangup','{}'::jsonb) returning * into v_signal;
    update public.server_call_members set left_at=coalesce(left_at,v_now)
     where call_id=v_call.id and user_id=p_user_id;
    return jsonb_build_object('ok',true,'state','ended','seq',v_signal.seq,'created_at',v_signal.created_at);
  end if;

  if p_action='signal' then
    if p_kind not in ('offer','answer','ice','hangup','state') or jsonb_typeof(v_payload)<>'object' then
      return jsonb_build_object('error','INVALID_SIGNAL');
    end if;
    if octet_length(v_payload::text)>18000 then return jsonb_build_object('error','PAYLOAD_TOO_LARGE'); end if;
    if p_kind='hangup' then
      update public.server_calls set state='ended',ended_at=v_now,updated_at=v_now
       where id=v_call.id and state in ('ringing','connecting','active') returning * into v_call;
    elsif p_kind in ('offer','answer') then
      update public.server_calls set state='connecting',updated_at=v_now
       where id=v_call.id and state in ('ringing','connecting') returning * into v_call;
    elsif p_kind='state' and v_payload->>'state'='active' then
      update public.server_calls set state='active',updated_at=v_now
       where id=v_call.id and state in ('ringing','connecting','active') returning * into v_call;
    end if;
    insert into public.server_call_signals(call_id,from_user_id,kind,payload)
    values(v_call.id,p_user_id,p_kind,v_payload) returning * into v_signal;
    if p_kind='hangup' then
      update public.server_call_members set left_at=coalesce(left_at,v_now)
       where call_id=v_call.id and user_id=p_user_id;
    end if;
    return jsonb_build_object('ok',true,'seq',v_signal.seq,'created_at',v_signal.created_at,'state',v_call.state);
  end if;
  return jsonb_build_object('error','INVALID_CALL_TRANSITION');
end;
$$;
revoke all on function public.server_call_transition_atomic(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.server_call_transition_atomic(uuid,uuid,text,text,jsonb) to service_role;
