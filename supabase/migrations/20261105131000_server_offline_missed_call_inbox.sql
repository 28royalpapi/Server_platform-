-- Store-and-forward missed-call record for a Server user who is offline on Server.
-- No push job or live ringing session is created by this function.
create or replace function public.server_create_missed_call_atomic(p_caller_user_id uuid,p_callee_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_call public.server_calls%rowtype; v_now timestamptz := clock_timestamp();
begin
  if p_caller_user_id is null or p_callee_user_id is null or p_caller_user_id=p_callee_user_id then
    raise exception 'INVALID_OFFLINE_CALL_PARTICIPANTS' using errcode='22023';
  end if;
  insert into public.server_calls(caller_user_id,callee_user_id,callee_phone_e164,route,state,created_at,updated_at,ended_at,expires_at)
  values(p_caller_user_id,p_callee_user_id,null,'server','missed',v_now,v_now,v_now,v_now) returning * into v_call;
  insert into public.server_call_members(call_id,user_id,member_role)
  values(v_call.id,p_caller_user_id,'caller'),(v_call.id,p_callee_user_id,'callee');
  return jsonb_build_object('call',jsonb_build_object('id',v_call.id,'state',v_call.state,'route',v_call.route,'created_at',v_call.created_at,'updated_at',v_call.updated_at,'expires_at',v_call.expires_at));
end;
$function$;
revoke all on function public.server_create_missed_call_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.server_create_missed_call_atomic(uuid,uuid) to service_role;
create index if not exists server_calls_user_missed_inbox_idx on public.server_calls(callee_user_id,updated_at desc,id) where route='server' and state='missed';
