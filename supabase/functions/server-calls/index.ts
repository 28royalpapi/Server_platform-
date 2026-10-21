import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const cors = {"access-control-allow-origin":"*","access-control-allow-headers":"authorization,apikey,content-type","access-control-allow-methods":"POST,OPTIONS","content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const out=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const phone=(v:unknown)=>typeof v==="string"&&/^\+[1-9][0-9]{7,14}$/.test(v.trim())?v.trim():null;
const allowed=new Set(["offer","answer","ice","hangup","state"]);
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 if(req.method!=="POST") return out({error:"METHOD_NOT_ALLOWED"},405);
 let b:Record<string,unknown>; try{b=await req.json();if(!b||Array.isArray(b)||typeof b!=="object")throw 0;}catch{return out({error:"INVALID_JSON"},400);}
 const url=Deno.env.get("SUPABASE_URL")||""; const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SUPABASE_SECRET_KEY")||"";
 if(!url||!key)return out({error:"SUPABASE_SERVER_CONFIG_MISSING"},500);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const auth=(req.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];
 if(!auth)return out({error:"AUTH_REQUIRED"},401);
 const {data:ud,error:ue}=await db.auth.getUser(auth);
 if(ue||!ud.user)return out({error:"AUTH_REQUIRED"},401);
 const uid=ud.user.id; const action=typeof b.action==="string"?b.action:"";
 try{
  if(action==="me"){
   const {data,error}=await db.from("server_profiles").select("user_id,phone_e164,accepted_terms_version,accepted_privacy_version,accepted_legal_at,notifications_enabled,contacts_access_requested,created_at").eq("user_id",uid).maybeSingle();
   if(error)return out({error:"PROFILE_LOOKUP_FAILED"},503);
   return out({profile:data||{user_id:uid,phone_e164:ud.user.phone||null}});
  }
  if(action==="save_preferences"){
   const terms=typeof b.terms_version==="string"?b.terms_version.slice(0,40):"",privacy=typeof b.privacy_version==="string"?b.privacy_version.slice(0,40):"";
   if(!terms||!privacy||b.accepted!==true)return out({error:"LEGAL_ACCEPTANCE_REQUIRED"},400);
   const patch={user_id:uid,phone_e164:phone(ud.user.phone),accepted_terms_version:terms,accepted_privacy_version:privacy,accepted_legal_at:new Date().toISOString(),notifications_enabled:b.notifications_enabled!==false,contacts_access_requested:b.contacts_access_requested===true,updated_at:new Date().toISOString()};
   const {data,error}=await db.from("server_profiles").upsert(patch,{onConflict:"user_id"}).select("user_id,accepted_terms_version,accepted_privacy_version,accepted_legal_at,notifications_enabled,contacts_access_requested").single();
   if(error||!data)return out({error:"PREFERENCES_SAVE_FAILED"},503); return out({ok:true,profile:data});
  }
  if(action==="start"){
   const to=phone(b.to_phone),caller=phone(ud.user.phone);
   if(!to||!caller)return out({error:"VERIFIED_PHONE_REQUIRED"},400);
   if(to===caller)return out({error:"CANNOT_CALL_SELF"},400);
   const {data:callee}=await db.from("server_profiles").select("user_id,phone_e164").eq("phone_e164",to).maybeSingle();
   const route=callee?"server":"guest";
   const now=new Date().toISOString();
   const {data:call,error:ce}=await db.from("server_calls").insert({caller_user_id:uid,callee_user_id:callee?.user_id||null,callee_phone_e164:to,route,state:"ringing",created_at:now,updated_at:now}).select("id,state,route,created_at,callee_phone_e164,callee_user_id").single();
   if(ce||!call)return out({error:"CALL_CREATE_FAILED"},503);
   await db.from("server_call_members").upsert([{call_id:call.id,user_id:uid,member_role:"caller"},{...(callee?{call_id:call.id,user_id:callee.user_id,member_role:"callee"}:{})}].filter(x=>!!x.user_id),{onConflict:"call_id,user_id"});
   if(route==="guest"){
    const {data:gateway}=await db.from("server_gateway_devices").select("id").eq("enabled",true).gte("last_seen_at",new Date(Date.now()-90000).toISOString()).limit(1).maybeSingle();
    if(!gateway){await db.from("server_calls").delete().eq("id",call.id);return out({error:"SMS_GATEWAY_OFFLINE"},503);}
    const token=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("");
    const tokenHash=await sha(token);const expires=new Date(Date.now()+20*60*1000).toISOString();
    const {data:invite,error:ie}=await db.from("server_guest_invites").insert({call_id:call.id,phone_e164:to,token_hash:tokenHash,expires_at:expires}).select("id").single();
    if(ie||!invite){await db.from("server_calls").delete().eq("id",call.id);return out({error:"INVITE_CREATE_FAILED"},503);}
    const guestUrl=(Deno.env.get("SERVER_GUEST_BASE_URL")||"https://server-interactive-preview.vercel.app/guest.html").replace(/\/$/,"");
    const smsBody="You have a Server internet-call invitation. Open this link while connected to the internet and allow microphone access: "+guestUrl+"?token="+encodeURIComponent(token)+" (expires in 20 minutes).";
    const {error:qe}=await db.from("server_sms_jobs").insert({category:"guest_invite",recipient_e164:to,body:smsBody,call_id:call.id,guest_invite_id:invite.id,status:"queued"});
    if(qe){await db.from("server_calls").delete().eq("id",call.id);return out({error:"INVITE_SMS_QUEUE_FAILED"},503);}
    return out({ok:true,call:{id:call.id,state:call.state,route,created_at:call.created_at},invite_expires_at:expires});
   }
   return out({ok:true,call});
  }
  if(action==="poll"){
   const callId=typeof b.call_id==="string"?b.call_id:"";
   if(callId){
    const {data:member}=await db.from("server_call_members").select("call_id").eq("call_id",callId).eq("user_id",uid).maybeSingle();
    if(!member)return out({error:"CALL_ACCESS_DENIED"},403);
   }
   let q=db.from("server_calls").select("id,state,route,caller_user_id,callee_user_id,callee_phone_e164,created_at,updated_at").or("caller_user_id.eq."+uid+",callee_user_id.eq."+uid).order("created_at",{ascending:false}).limit(30);
   if(callId)q=q.eq("id",callId);
   const {data:calls,error}=await q;if(error)return out({error:"CALL_POLL_FAILED"},503);
   let signals:unknown[]=[];
   if(callId){
    const after=Number.isSafeInteger(b.after_seq)&&Number(b.after_seq)>=0?Number(b.after_seq):0;
    const {data:s,error:se}=await db.from("server_call_signals").select("seq,from_user_id,kind,payload,created_at").eq("call_id",callId).gt("seq",after).order("seq",{ascending:true}).limit(100);
    if(se)return out({error:"SIGNAL_POLL_FAILED"},503);signals=(s||[]).filter((x:any)=>x.from_user_id!==uid);
   }
   return out({calls:calls||[],signals,next_after_seq:signals.length?(signals[signals.length-1] as any).seq:(Number(b.after_seq)||0)});
  }
  if(action==="answer"||action==="hangup"||action==="set_active"){
   const callId=typeof b.call_id==="string"?b.call_id:"";if(!callId)return out({error:"CALL_ID_REQUIRED"},400);
   const {data:member}=await db.from("server_call_members").select("member_role").eq("call_id",callId).eq("user_id",uid).maybeSingle();
   if(!member)return out({error:"CALL_ACCESS_DENIED"},403);
   const now=new Date().toISOString();
   if(action==="answer"){
    const {data:call}=await db.from("server_calls").select("id,state,callee_user_id").eq("id",callId).maybeSingle();
    if(!call||call.callee_user_id!==uid||!["ringing","connecting"].includes(call.state))return out({error:"CALL_NOT_ANSWERABLE"},409);
    await db.from("server_calls").update({state:"connecting",updated_at:now}).eq("id",callId);
    await db.from("server_call_members").update({joined_at:now}).eq("call_id",callId).eq("user_id",uid);
    return out({ok:true,state:"connecting",ice_servers:[{urls:"stun:stun.l.google.com:19302"}]});
   }
   if(action==="set_active"){
    const {error}=await db.from("server_calls").update({state:"active",updated_at:now}).eq("id",callId).in("state",["ringing","connecting"]);
    if(error)return out({error:"CALL_STATE_UPDATE_FAILED"},503);return out({ok:true,state:"active"});
   }
   await db.from("server_call_signals").insert({call_id:callId,from_user_id:uid,kind:"hangup",payload:{}});
   const {error}=await db.from("server_calls").update({state:"ended",ended_at:now,updated_at:now}).eq("id",callId);
   if(error)return out({error:"CALL_END_FAILED"},503);
   await db.from("server_call_members").update({left_at:now}).eq("call_id",callId).eq("user_id",uid);return out({ok:true,state:"ended"});
  }
  if(action==="signal"){
   const callId=typeof b.call_id==="string"?b.call_id:"",kind=typeof b.kind==="string"?b.kind:"",payload=b.payload&&typeof b.payload==="object"&&!Array.isArray(b.payload)?b.payload:{};
   if(!callId||!allowed.has(kind)||JSON.stringify(payload).length>18000)return out({error:"INVALID_SIGNAL"},400);
   const {data:member}=await db.from("server_call_members").select("call_id").eq("call_id",callId).eq("user_id",uid).maybeSingle();
   if(!member)return out({error:"CALL_ACCESS_DENIED"},403);
   const {data:signal,error}=await db.from("server_call_signals").insert({call_id:callId,from_user_id:uid,kind,payload}).select("seq,created_at").single();
   if(error||!signal)return out({error:"SIGNAL_SAVE_FAILED"},503);
   if(kind==="hangup"){const now=new Date().toISOString();await db.from("server_calls").update({state:"ended",ended_at:now,updated_at:now}).eq("id",callId);}
   return out({ok:true,seq:signal.seq,created_at:signal.created_at});
  }
  if(action==="ice_servers")return out({ice_servers:[{urls:"stun:stun.l.google.com:19302"}]});
  return out({error:"UNKNOWN_ACTION"},400);
 }catch{return out({error:"SERVER_CALLS_INTERNAL_ERROR"},500);}
});