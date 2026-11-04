import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const cors = {"access-control-allow-origin":"*","access-control-allow-headers":"authorization,apikey,content-type","access-control-allow-methods":"POST,OPTIONS","content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const out=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const phone=(v:unknown)=>typeof v==="string"&&/^\+[1-9][0-9]{7,14}$/.test(v.trim())?v.trim():null;
const allowed=new Set(["offer","answer","ice","hangup","state"]);

const SERVER_CALL_TTL_SECONDS = 180;
const GUEST_CALL_TTL_SECONDS = 20 * 60;
const BASE_ICE_SERVERS = [
 {urls:"stun:stun.cloudflare.com:3478"},
 {urls:"stun:stun.l.google.com:19302"}
];
/**
 * Optional coturn REST credentials. Configure SERVER_TURN_URLS and
 * SERVER_TURN_SHARED_SECRET together in Supabase secrets. With neither set,
 * Server continues using both public STUN discovery endpoints. TURN URLs and
 * shared credentials are never embedded in a client or committed to source.
 */
async function iceServersForCall(identity:string, ttlSeconds:number) {
 const rawUrls=Deno.env.get("SERVER_TURN_URLS")||"";
 const sharedSecret=Deno.env.get("SERVER_TURN_SHARED_SECRET")||"";
 if(!rawUrls||sharedSecret.length<32)return BASE_ICE_SERVERS;
 const turnUrls=rawUrls.split(",").map((url:string)=>url.trim())
  .filter((url:string)=>/^turns?:[^\s@]+$/i.test(url)).slice(0,8);
 if(!turnUrls.length)return BASE_ICE_SERVERS;
 const safeIdentity=identity.replace(/[^A-Za-z0-9_.-]/g,"").slice(0,80)||"server";
 const expires=Math.floor(Date.now()/1000)+Math.max(300,Math.min(3600,ttlSeconds+120));
 const username=expires+":"+safeIdentity;
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(sharedSecret),
  {name:"HMAC",hash:"SHA-1"},false,["sign"]);
 const signature=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(username)));
 const credential=btoa(String.fromCharCode(...signature));
 return [{urls:turnUrls,username,credential},...BASE_ICE_SERVERS];
}
let cachedFcmAccessToken: { token: string; expiresAt: number } | null = null;
let cachedApnsJwt: { token: string; expiresAt: number } | null = null;
const b64url = (value: string | Uint8Array) => {
 const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
 let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
 return btoa(binary).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
};
const pemBytes = (pem: string) => {
 const clean = pem.replace(/-----BEGIN [^-]+-----/g,"").replace(/-----END [^-]+-----/g,"").replace(/\s/g,"");
 return Uint8Array.from(atob(clean), c => c.charCodeAt(0));
};
async function firebaseAccessToken() {
 if (cachedFcmAccessToken && cachedFcmAccessToken.expiresAt > Date.now()+60000) return cachedFcmAccessToken.token;
 const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") || "";
 if (!raw) return null;
 const sa = JSON.parse(raw);
 const issued = Math.floor(Date.now()/1000);
 const input = b64url(JSON.stringify({alg:"RS256",typ:"JWT"}))+"."+b64url(JSON.stringify({
  iss:sa.client_email,scope:"https://www.googleapis.com/auth/firebase.messaging",
  aud:"https://oauth2.googleapis.com/token",iat:issued,exp:issued+3600
 }));
 const key = await crypto.subtle.importKey("pkcs8",pemBytes(String(sa.private_key||"").replace(/\\n/g,"\n")),
  {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
 const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(input)));
 const assertion = input+"."+b64url(signature);
 const form = new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion});
 const response = await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form});
 if(!response.ok) throw new Error("FCM_OAUTH_"+response.status);
 const tokenBody = await response.json();
 cachedFcmAccessToken = {token:tokenBody.access_token,expiresAt:Date.now()+Math.max(60,Number(tokenBody.expires_in)||3600)*1000};
 return cachedFcmAccessToken.token;
}
async function apnsBearer() {
 if(cachedApnsJwt&&cachedApnsJwt.expiresAt>Date.now()+60000)return cachedApnsJwt.token;
 const team=Deno.env.get("APNS_TEAM_ID")||"",kid=Deno.env.get("APNS_KEY_ID")||"",pem=Deno.env.get("APNS_PRIVATE_KEY")||"";
 if(!team||!kid||!pem)return null;
 const issued=Math.floor(Date.now()/1000);
 const input=b64url(JSON.stringify({alg:"ES256",kid,typ:"JWT"}))+"."+b64url(JSON.stringify({iss:team,iat:issued}));
 const key=await crypto.subtle.importKey("pkcs8",pemBytes(pem.replace(/\\n/g,"\n")),{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
 const signature=new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},key,new TextEncoder().encode(input)));
 const jwt=input+"."+b64url(signature);
 cachedApnsJwt={token:jwt,expiresAt:Date.now()+50*60*1000};
 return jwt;
}
async function sendRecipientPush(db:any,recipientUserId:string,callId:string,callerLabel:string) {
 const {data:devices,error}=await db.from("server_push_devices").select("id,platform,token").eq("user_id",recipientUserId);
 if(error||!devices?.length)return {sent:0,configured:false,reason:"NO_REGISTERED_PUSH_ENDPOINT"};
 let sent=0,failures=0;
 for(const device of devices) {
  try {
   if(device.platform==="android") {
    const authToken=await firebaseAccessToken();
    if(!authToken)continue;
    const sa=JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON")||"");
    const project=sa.project_id||Deno.env.get("FIREBASE_PROJECT_ID")||"";
    if(!project)continue;
    const response=await fetch("https://fcm.googleapis.com/v1/projects/"+encodeURIComponent(project)+"/messages:send",{
     method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+authToken},
     body:JSON.stringify({message:{token:device.token,data:{
      type:"server_incoming_call",call_id:callId,caller_label:callerLabel,expires_in:String(SERVER_CALL_TTL_SECONDS)
     },android:{priority:"HIGH",ttl:SERVER_CALL_TTL_SECONDS+"s",collapse_key:"server-live-call"}}})
    });
    if(response.ok)sent++;else {failures++;if(response.status===404||response.status===400)await db.from("server_push_devices").delete().eq("id",device.id);}
   } else if(device.platform==="ios_voip") {
    const jwt=await apnsBearer(),bundle=Deno.env.get("APNS_BUNDLE_ID")||"com.server.caller";
    if(!jwt)continue;
    const response=await fetch("https://api.push.apple.com/3/device/"+encodeURIComponent(device.token),{
     method:"POST",headers:{"authorization":"bearer "+jwt,"apns-topic":bundle+".voip","apns-push-type":"voip",
      "apns-priority":"10","apns-expiration":String(Math.floor(Date.now()/1000)+SERVER_CALL_TTL_SECONDS)},
     body:JSON.stringify({aps:{},type:"server_incoming_call",call_id:callId,caller_label:callerLabel,expires_in:SERVER_CALL_TTL_SECONDS})
    });
    if(response.ok)sent++;else {failures++;if(response.status===410)await db.from("server_push_devices").delete().eq("id",device.id);}
   }
  } catch { failures++; }
 }
 return {sent,configured:true,failures};
}
async function expireStaleRingingCalls(db:any) {
 const now=new Date().toISOString();
 await db.from("server_calls").update({state:"missed",ended_at:now,updated_at:now})
  .in("state",["ringing","connecting"]).not("expires_at","is",null).lt("expires_at",now);
}

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 if(req.method!=="POST") return out({error:"METHOD_NOT_ALLOWED"},405);
 let b:Record<string,unknown>; try{b=await req.json();if(!b||Array.isArray(b)||typeof b!=="object")throw 0;}catch{return out({error:"INVALID_JSON"},400);}
 const url=Deno.env.get("SUPABASE_URL")||""; const key=(()=>{const raw=Deno.env.get("SUPABASE_SECRET_KEYS");if(raw){try{const parsed=JSON.parse(raw);if(parsed&&typeof parsed==="object")return parsed.default||Object.values(parsed)[0]||"";}catch{}}return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SUPABASE_SECRET_KEY")||"";})();
 if(!url||!key)return out({error:"SUPABASE_SERVER_CONFIG_MISSING"},500);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const auth=(req.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]||"";
 if(!/^[0-9a-f]{64}$/.test(auth))return out({error:"SESSION_REQUIRED"},401);
 const sessionHash=await sha(auth);
 const {data:session,error:sessionError}=await db.from("server_sessions").select("id,user_id,expires_at").eq("token_hash",sessionHash).is("revoked_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();
 if(sessionError||!session)return out({error:"SESSION_REQUIRED"},401);
 const {data:profile,error:profileError}=await db.from("server_profiles").select("user_id,server_id,phone_e164,phone_verified_at,allow_number_based_server_calls").eq("user_id",session.user_id).maybeSingle();
 if(profileError||!profile)return out({error:"PROFILE_REQUIRED"},401);
 await db.from("server_sessions").update({last_seen_at:new Date().toISOString()}).eq("id",session.id);
 const uid=profile.user_id; const action=typeof b.action==="string"?b.action:"";
 try{
  await expireStaleRingingCalls(db);
  if(action==="register_push_token"){
   const pushToken=typeof b.push_token==="string"?b.push_token.trim():"";
   const platform=typeof b.platform==="string"?b.platform:"";
   if(!["android","ios_voip"].includes(platform)||pushToken.length<40||pushToken.length>4096)return out({error:"INVALID_PUSH_TOKEN"},400);
   const {error}=await db.from("server_push_devices").upsert({user_id:uid,platform,token:pushToken,updated_at:new Date().toISOString()},{onConflict:"platform,token"});
   if(error)return out({error:"PUSH_TOKEN_REGISTER_FAILED"},503);
   return out({ok:true,registered:true,platform});
  }
  if(action==="remove_push_token"){
   const pushToken=typeof b.push_token==="string"?b.push_token.trim():"";
   if(!pushToken)return out({error:"PUSH_TOKEN_REQUIRED"},400);
   const {error}=await db.from("server_push_devices").delete().eq("user_id",uid).eq("token",pushToken);
   if(error)return out({error:"PUSH_TOKEN_REMOVE_FAILED"},503);
   return out({ok:true,removed:true});
  }
  if(action==="me"){
   const {data,error}=await db.from("server_profiles").select("user_id,server_id,phone_e164,phone_verified_at,allow_number_based_server_calls,accepted_terms_version,accepted_privacy_version,accepted_legal_at,notifications_enabled,contacts_access_requested,created_at").eq("user_id",uid).maybeSingle();
   if(error)return out({error:"PROFILE_LOOKUP_FAILED"},503);
   return out({profile:data||{user_id:uid,phone_e164:profile.phone_e164}});
  }
  if(action==="save_preferences"){
   const terms=typeof b.terms_version==="string"?b.terms_version.slice(0,40):"",privacy=typeof b.privacy_version==="string"?b.privacy_version.slice(0,40):"";
   if(!terms||!privacy||b.accepted!==true)return out({error:"LEGAL_ACCEPTANCE_REQUIRED"},400);
   const patch={user_id:uid,phone_e164:phone(profile.phone_e164),accepted_terms_version:terms,accepted_privacy_version:privacy,accepted_legal_at:new Date().toISOString(),notifications_enabled:b.notifications_enabled!==false,contacts_access_requested:b.contacts_access_requested===true,updated_at:new Date().toISOString()};
   const {data,error}=await db.from("server_profiles").upsert(patch,{onConflict:"user_id"}).select("user_id,accepted_terms_version,accepted_privacy_version,accepted_legal_at,notifications_enabled,contacts_access_requested").single();
   if(error||!data)return out({error:"PREFERENCES_SAVE_FAILED"},503); return out({ok:true,profile:data});
  }
  if(action==="start"){
   const serverTarget=typeof b.to_server_id==="string"?b.to_server_id.trim().toUpperCase():"";
   const to=phone(b.to_phone);
   if(!serverTarget&&!to)return out({error:"RECIPIENT_REQUIRED"},400);
   let callee:any=null;
   let route:"server"|"guest"="guest";
   let recipientPhone:string|null=to;
   if(serverTarget){
    if(!/^SVR-[0-9A-F]{10}$/.test(serverTarget))return out({error:"INVALID_SERVER_ID"},400);
    const {data:found,error:lookupError}=await db.from("server_profiles")
      .select("user_id,server_id,phone_e164,phone_verified_at").eq("server_id",serverTarget).maybeSingle();
    if(lookupError)return out({error:"SERVER_LOOKUP_FAILED"},503);
    if(!found)return out({error:"SERVER_ID_NOT_FOUND"},404);
    if(found.user_id===uid)return out({error:"CANNOT_CALL_SELF"},400);
    callee=found;route="server";recipientPhone=phone(found.phone_e164);
   }else{
    if(!to)return out({error:"INVALID_PHONE_FORMAT"},400);
    if(profile.phone_verified_at&&phone(profile.phone_e164)===to)return out({error:"CANNOT_CALL_SELF"},400);
    const {data:found,error:lookupError}=await db.from("server_profiles")
      .select("user_id,server_id,phone_e164,phone_verified_at,allow_number_based_server_calls")
      .eq("phone_e164",to).maybeSingle();
    if(lookupError)return out({error:"SERVER_LOOKUP_FAILED"},503);
    // A verified number only resolves to Server when the owner explicitly opted in.
    // Otherwise keep the caller on the existing guest invitation route.
    callee=found&&found.phone_verified_at&&found.allow_number_based_server_calls===true?found:null;
    route=callee?"server":"guest";
   }
   const now=new Date().toISOString();
   const callTtlSeconds=route==="guest"?GUEST_CALL_TTL_SECONDS:SERVER_CALL_TTL_SECONDS;
   const expiresAt=new Date(Date.now()+callTtlSeconds*1000).toISOString();
   const {data:call,error:ce}=await db.from("server_calls").insert({
    caller_user_id:uid,callee_user_id:callee?.user_id||null,callee_phone_e164:recipientPhone,
    route,state:"ringing",created_at:now,updated_at:now,expires_at:expiresAt
   }).select("id,state,route,created_at,updated_at,expires_at").single();
   if(ce||!call)return out({error:"CALL_CREATE_FAILED"},503);
   const callIceServers=await iceServersForCall(call.id,callTtlSeconds);
   await db.from("server_call_members").upsert([
    {call_id:call.id,user_id:uid,member_role:"caller"},
    ...(callee?[{call_id:call.id,user_id:callee.user_id,member_role:"callee"}]:[])
   ],{onConflict:"call_id,user_id"});
   let pushDelivery:any={sent:0,configured:false,reason:"NOT_A_SERVER_USER"};
   if(route==="server"&&callee?.user_id){pushDelivery=await sendRecipientPush(db,callee.user_id,call.id,profile.server_id||"A Server user");}
   if(route==="guest"){
    if(!to){await db.from("server_calls").delete().eq("id",call.id);return out({error:"RECIPIENT_PHONE_REQUIRED"},400);}
    // Pilot policy: guest calling has no caller/recipient invitation quota.
    // Rate/plan caps are a product decision for a later paid rollout, not a
    // prerequisite for WebRTC or Android Telecom. Keep each invite authenticated,
    // token-hashed, one-call scoped and expiring; no automatic carrier SMS is sent.
    const token=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("");
    const tokenHash=await sha(token),expires=new Date(Date.now()+20*60*1000).toISOString();
    const {data:invite,error:ie}=await db.from("server_guest_invites").insert({
      call_id:call.id,phone_e164:to,token_hash:tokenHash,expires_at:expires
    }).select("id").single();
    if(ie||!invite){await db.from("server_calls").delete().eq("id",call.id);return out({error:"INVITE_CREATE_FAILED"},503);}
    const guestUrl="https://server-onboarding-ochre.vercel.app/guest.html";
    const callerLabel=typeof profile.server_id==="string"&&profile.server_id?profile.server_id:"A Server user";
    const smsBody=callerLabel+" is trying to call you through Server. You do not need to install the Server app. Open this link in Chrome or Safari while connected to the internet, then tap Accept to enable your microphone: "+guestUrl+"#token="+encodeURIComponent(token)+" (expires in 20 minutes).";
    const manualDelivery=(reason:string)=>out({
      ok:true,call_id:call.id,route,ice_servers:callIceServers,call,
      invite_expires_at:expires,delivery_mode:"manual_share",delivery_channel:"manual_share",
      guest_invite_url:guestUrl,invitation_text:smsBody,sms_body:smsBody,delivery_message:reason
    });
    // Guest-call invitations must not silently consume a user's SMS balance.
    // The caller explicitly chooses an existing share/messaging app instead.
    return manualDelivery("Server does not send automatic or paid SMS for guest invitations. Share the secure invitation using an app already on your phone; the recipient needs internet to answer.");
  }
  return out({ok:true,call_id:call.id,route,ice_servers:callIceServers,call,call_expires_at:expiresAt,push_delivery:pushDelivery});
 }
 if(action==="incoming"){
   const {data:incoming,error:incomingError}=await db.from("server_calls").select("id,state,route,caller_user_id,created_at,updated_at").eq("callee_user_id",uid).in("state",["ringing","connecting","missed"]).gte("updated_at",new Date(Date.now()-14*24*60*60*1000).toISOString()).order("created_at",{ascending:false}).limit(40);
   if(incomingError)return out({error:"INCOMING_CALL_POLL_FAILED"},503);
   const ids=(incoming||[]).map((x:any)=>x.caller_user_id);
   const {data:profiles}=ids.length?await db.from("server_profiles")
     .select("user_id,phone_e164,phone_verified_at,allow_number_based_server_calls,server_id").in("user_id",ids):{data:[]};
   const rows=new Map((profiles||[]).map((p:any)=>[p.user_id,p]));
   return out({calls:(incoming||[]).map((c:any)=>{
    const caller:any=rows.get(c.caller_user_id)||{};
    // Never disclose a stored phone number to the callee unless the owner
    // verified it and explicitly opted into number-based Server calls.
    const sharedPhone=caller.phone_verified_at&&caller.allow_number_based_server_calls===true?phone(caller.phone_e164):null;
    return {id:c.id,state:c.state,route:c.route,caller_phone_e164:sharedPhone||"",caller_server_id:caller.server_id||"",created_at:c.created_at,updated_at:c.updated_at};
   })});
  }
  if(action==="poll"){
   const callId=typeof b.call_id==="string"?b.call_id:"";
   if(callId){
    const {data:member}=await db.from("server_call_members").select("call_id").eq("call_id",callId).eq("user_id",uid).maybeSingle();
    if(!member)return out({error:"CALL_ACCESS_DENIED"},403);
   }
   let q=db.from("server_calls").select("id,state,route,created_at,updated_at,expires_at").or("caller_user_id.eq."+uid+",callee_user_id.eq."+uid).order("created_at",{ascending:false}).limit(30);
   if(callId)q=q.eq("id",callId);
   const {data:calls,error}=await q;if(error)return out({error:"CALL_POLL_FAILED"},503);
   let signals:unknown[]=[];
   if(callId){
    const after=Number.isSafeInteger(b.after_seq)&&Number(b.after_seq)>=0?Number(b.after_seq):0;
    const {data:s,error:se}=await db.from("server_call_signals").select("seq,from_user_id,kind,payload,created_at").eq("call_id",callId).gt("seq",after).order("seq",{ascending:true}).limit(100);
    if(se)return out({error:"SIGNAL_POLL_FAILED"},503);const rows=s||[];signals=rows.filter((x:any)=>x.from_user_id!==uid);
   }
   const rows=(signals as any[]);const call=callId?(calls||[]).find((x:any)=>x.id===callId)||null:null;
   const {data:allSignals}=callId?await db.from("server_call_signals").select("seq").eq("call_id",callId).gt("seq",Number(b.after_seq)||0).order("seq",{ascending:true}).limit(100):{data:[]};
   return out({calls:calls||[],call,signals,next_after_seq:allSignals?.length?allSignals[allSignals.length-1].seq:(Number(b.after_seq)||0)});
  }
  if(action==="answer"||action==="accept"||action==="hangup"||action==="end"||action==="set_active"){
   const callId=typeof b.call_id==="string"?b.call_id:"";if(!callId)return out({error:"CALL_ID_REQUIRED"},400);
   const {data:member}=await db.from("server_call_members").select("member_role").eq("call_id",callId).eq("user_id",uid).maybeSingle();
   if(!member)return out({error:"CALL_ACCESS_DENIED"},403);
   const now=new Date().toISOString();
   if(action==="answer"||action==="accept"){
    const {data:call}=await db.from("server_calls").select("id,state,callee_user_id,expires_at").eq("id",callId).maybeSingle();
    if(!call||call.callee_user_id!==uid||!["ringing","connecting"].includes(call.state)||(call.expires_at&&Date.parse(call.expires_at)<=Date.now()))return out({error:"CALL_NOT_ANSWERABLE"},409);
    await db.from("server_calls").update({state:"connecting",updated_at:now}).eq("id",callId);
    await db.from("server_call_members").update({joined_at:now}).eq("call_id",callId).eq("user_id",uid);
    return out({ok:true,state:"connecting",ice_servers:await iceServersForCall(callId,SERVER_CALL_TTL_SECONDS)});
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
  if(action==="ice_servers")return out({ice_servers:await iceServersForCall(uid,SERVER_CALL_TTL_SECONDS)});
  return out({error:"UNKNOWN_ACTION"},400);
 }catch{return out({error:"SERVER_CALLS_INTERNAL_ERROR"},500);}
});