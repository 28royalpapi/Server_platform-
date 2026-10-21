import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const cors={"access-control-allow-origin":"*","access-control-allow-headers":"authorization,apikey,content-type","access-control-allow-methods":"POST,OPTIONS","content-type":"application/json"};
const out=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:cors});
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const phone=(x:unknown)=>typeof x==="string"&&/^\+[1-9][0-9]{7,14}$/.test(x.trim())?x.trim():null;
const rand=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("");
function db(){const u=Deno.env.get("SUPABASE_URL")||"";let k=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SUPABASE_SECRET_KEY")||"";if(!k){try{const x=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");k=x.default||Object.values(x)[0]||""}catch{}}if(!u||!k)throw 0;return createClient(u,k,{auth:{persistSession:false,autoRefreshToken:false}})}
Deno.serve(async(req)=>{if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return out({error:"METHOD_NOT_ALLOWED"},405);let b:any;try{b=await req.json()}catch{return out({error:"INVALID_JSON"},400)}let d:any;try{d=db()}catch{return out({error:"SERVER_NOT_CONFIGURED"},500)}const bearer=(req.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]||"";if(!/^[0-9a-f]{64}$/.test(bearer))return out({error:"SESSION_REQUIRED"},401);const {data:s}=await d.from("server_sessions").select("id,user_id").eq("token_hash",await sha(bearer)).is("revoked_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();if(!s)return out({error:"SESSION_REQUIRED"},401);const {data:profile}=await d.from("server_profiles").select("user_id,phone_e164,phone_verified_at").eq("user_id",s.user_id).maybeSingle();if(!profile?.phone_verified_at)return out({error:"VERIFIED_PROFILE_REQUIRED"},401);await d.from("server_sessions").update({last_seen_at:new Date().toISOString()}).eq("id",s.id);const action=String(b.action||"");
if(action==="save_preferences"){
 const terms=typeof b.terms_version==="string"?b.terms_version.trim().slice(0,40):"";
 const privacy=typeof b.privacy_version==="string"?b.privacy_version.trim().slice(0,40):"";
 if(b.accepted!==true||!terms||!privacy)return out({error:"LEGAL_ACCEPTANCE_REQUIRED"},400);
 const {data:saved,error}=await d.from("server_profiles").update({
  accepted_terms_version:terms,accepted_privacy_version:privacy,accepted_legal_at:new Date().toISOString(),
  notifications_enabled:b.notifications_enabled!==false,contacts_access_requested:b.contacts_access_requested===true,
  updated_at:new Date().toISOString()
 }).eq("user_id",s.user_id).select("user_id,accepted_terms_version,accepted_privacy_version,accepted_legal_at,notifications_enabled,contacts_access_requested").maybeSingle();
 if(error||!saved)return out({error:"PREFERENCES_SAVE_FAILED"},503);
 return out({ok:true,profile:saved});
}
if(action==="incoming"){
 const {data:incoming,error}=await d.from("server_calls").select("id,state,route,caller_user_id,callee_phone_e164,created_at,updated_at").eq("callee_user_id",s.user_id).in("state",["ringing","connecting"]).order("created_at",{ascending:false}).limit(20);
 if(error)return out({error:"INCOMING_CALL_POLL_FAILED"},503);
 const ids=(incoming||[]).map((x:any)=>x.caller_user_id);
 const {data:callers}=ids.length?await d.from("server_profiles").select("user_id,phone_e164").in("user_id",ids):{data:[]};
 const phones=new Map((callers||[]).map((x:any)=>[x.user_id,x.phone_e164]));
 return out({calls:(incoming||[]).map((x:any)=>({id:x.id,state:x.state,route:x.route,caller_phone_e164:phones.get(x.caller_user_id)||"Server caller",created_at:x.created_at,updated_at:x.updated_at}))});
}
if(action==="start"){const to=phone(b.to_phone||b.phone_e164);if(!to||to===profile.phone_e164)return out({error:"INVALID_DESTINATION"},400);const {data:callee}=await d.from("server_profiles").select("user_id").eq("phone_e164",to).maybeSingle();const route=callee?"server":"guest";const {data:call,error}=await d.from("server_calls").insert({caller_user_id:s.user_id,callee_user_id:callee?.user_id||null,callee_phone_e164:to,route,state:"ringing"}).select("id,state,route,created_at,callee_user_id").single();if(error||!call)return out({error:"CALL_CREATE_FAILED"},503);const ms=[{call_id:call.id,user_id:s.user_id,member_role:"caller"}];if(callee)ms.push({call_id:call.id,user_id:callee.user_id,member_role:"callee"});const {error:me}=await d.from("server_call_members").insert(ms);if(me){await d.from("server_calls").delete().eq("id",call.id);return out({error:"CALL_MEMBERSHIP_FAILED"},503)}if(route==="guest"){const {data:gw}=await d.from("server_gateway_devices").select("id").eq("enabled",true).gte("last_seen_at",new Date(Date.now()-90000).toISOString()).limit(1).maybeSingle();if(!gw){await d.from("server_calls").delete().eq("id",call.id);return out({error:"SMS_GATEWAY_OFFLINE"},503)}const raw=rand(),expires=new Date(Date.now()+20*60000).toISOString();const {data:inv,error:ie}=await d.from("server_guest_invites").insert({call_id:call.id,phone_e164:to,token_hash:await sha(raw),expires_at:expires}).select("id").single();if(ie||!inv){await d.from("server_calls").delete().eq("id",call.id);return out({error:"INVITE_CREATE_FAILED"},503)}const base=(Deno.env.get("SERVER_GUEST_BASE_URL")||"https://hzuovekqsjtpvmbuybxs.supabase.co/functions/v1/server-web").replace(/\/$/,"");const link=base+"?token="+encodeURIComponent(raw);const {error:qe}=await d.from("server_sms_jobs").insert({category:"guest_invite",recipient_e164:to,body:"Server internet-call invitation. Open while online and allow microphone access: "+link,call_id:call.id,guest_invite_id:inv.id});if(qe)return out({error:"INVITE_SMS_QUEUE_FAILED"},503);return out({ok:true,call,guest_invite_url:link,invite_expires_at:expires,ice_servers:[{urls:"stun:stun.l.google.com:19302"}]})}return out({ok:true,call,ice_servers:[{urls:"stun:stun.l.google.com:19302"}]})}
if(action==="poll"){const id=typeof b.call_id==="string"?b.call_id:"";if(id){const {data:m}=await d.from("server_call_members").select("call_id").eq("call_id",id).eq("user_id",s.user_id).maybeSingle();if(!m)return out({error:"CALL_ACCESS_DENIED"},403)}let q=d.from("server_calls").select("id,state,route,caller_user_id,callee_user_id,callee_phone_e164,created_at,updated_at").or("caller_user_id.eq."+s.user_id+",callee_user_id.eq."+s.user_id).order("created_at",{ascending:false}).limit(30);if(id)q=q.eq("id",id);const {data:calls,error}=await q;if(error)return out({error:"CALL_POLL_FAILED"},503);let signals:any[]=[];if(id){const after=Math.max(0,Number(b.after_seq)||0);const {data:sg,error:se}=await d.from("server_call_signals").select("seq,from_user_id,kind,payload,created_at").eq("call_id",id).gt("seq",after).order("seq",{ascending:true}).limit(100);if(se)return out({error:"SIGNAL_POLL_FAILED"},503);signals=(sg||[]).filter((x:any)=>x.from_user_id!==s.user_id)}return out({calls:calls||[],call:id?(calls||[]).find((x:any)=>x.id===id)||null:null,signals,next_after_seq:signals.length?signals[signals.length-1].seq:(Number(b.after_seq)||0)})}
if(action==="signal"){const id=String(b.call_id||""),kind=String(b.kind||"");if(!id||!["offer","answer","ice","hangup","state"].includes(kind)||JSON.stringify(b.payload||{}).length>18000)return out({error:"INVALID_SIGNAL"},400);const {data:m}=await d.from("server_call_members").select("call_id").eq("call_id",id).eq("user_id",s.user_id).maybeSingle();if(!m)return out({error:"CALL_ACCESS_DENIED"},403);const {data:sg,error}=await d.from("server_call_signals").insert({call_id:id,from_user_id:s.user_id,kind,payload:b.payload||{}}).select("seq").single();if(error||!sg)return out({error:"SIGNAL_SAVE_FAILED"},503);if(kind==="hangup")await d.from("server_calls").update({state:"ended",ended_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",id);return out({ok:true,seq:sg.seq})}
if(action==="accept"||action==="answer"||action==="hangup"){
 const id=String(b.call_id||"");if(!id)return out({error:"CALL_ID_REQUIRED"},400);
 const {data:m}=await d.from("server_call_members").select("member_role").eq("call_id",id).eq("user_id",s.user_id).maybeSingle();
 if(!m)return out({error:"CALL_ACCESS_DENIED"},403);
 const now=new Date().toISOString();
 if(action==="accept"||action==="answer"){
  const {data:call}=await d.from("server_calls").select("id,state,callee_user_id").eq("id",id).maybeSingle();
  if(!call||call.callee_user_id!==s.user_id||!["ringing","connecting"].includes(call.state))return out({error:"CALL_NOT_ANSWERABLE"},409);
  const {error}=await d.from("server_calls").update({state:"connecting",updated_at:now}).eq("id",id);
  if(error)return out({error:"CALL_STATE_UPDATE_FAILED"},503);
  await d.from("server_call_members").update({joined_at:now}).eq("call_id",id).eq("user_id",s.user_id);
  return out({ok:true,state:"connecting",ice_servers:[{urls:"stun:stun.l.google.com:19302"}]});
 }
 await d.from("server_call_signals").insert({call_id:id,from_user_id:s.user_id,kind:"hangup",payload:{}});
 const {error}=await d.from("server_calls").update({state:"ended",ended_at:now,updated_at:now}).eq("id",id);
 if(error)return out({error:"CALL_STATE_UPDATE_FAILED"},503);
 await d.from("server_call_members").update({left_at:now}).eq("call_id",id).eq("user_id",s.user_id);
 return out({ok:true,state:"ended"});
}
if(action==="me"){return out({ok:true,profile})}
return out({error:"UNKNOWN_ACTION"},400)});