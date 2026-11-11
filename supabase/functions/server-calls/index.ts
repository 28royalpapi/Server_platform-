import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { sendGuestBrowserPush } from "../_shared/guest_web_push.ts";
import { sendTextBeeSms } from "../_shared/textbee_sms.ts";
const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function jsonBase64Url(value: unknown): string {
  return base64Url(encoder.encode(JSON.stringify(value)));
}

function env(name: string): string {
  return (Deno.env.get(name) || "").trim();
}

function realtimePublicUrl(): string {
  const value = env("CENTRIFUGO_PUBLIC_URL");
  return /^wss?:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^\s]*)?$/i.test(value) ? value : "";
}

/**
 * Issues a short-lived Centrifugo connection JWT. Its channels claim creates
 * server-side subscriptions, not client-side publish permissions. The caller
 * must authorize every requested channel before invoking this helper.
 */
async function issueRealtimeToken(
  subject: string,
  channels: string[],
  ttlSeconds = 900
): Promise<{ url: string; token: string } | null> {
  const publicUrl = realtimePublicUrl();
  const secret = env("CENTRIFUGO_TOKEN_HMAC_SECRET_KEY");
  if (!publicUrl || secret.length < 32 || !subject || !channels.length) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = jsonBase64Url({ alg: "HS256", typ: "JWT" });
  const claims = jsonBase64Url({
    sub: subject,
    iat: now,
    exp: now + Math.max(60, Math.min(1800, ttlSeconds)),
    channels: [...new Set(channels)]
  });
  const input = header + "." + claims;
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(input))
  );
  return { url: publicUrl, token: input + "." + base64Url(signature) };
}

/**
 * Publish only after the authoritative DB transition committed. Centrifugo is
 * a low-latency notification plane; Postgres remains the durable source of truth.
 * A missing/unavailable realtime service must never roll back a saved call.
 */
async function publishRealtime(
  channel: string,
  data: Record<string, unknown>,
  idempotencyKey?: string
): Promise<boolean> {
  const apiUrl = env("CENTRIFUGO_API_URL");
  const apiKey = env("CENTRIFUGO_API_KEY");
  if (!apiUrl || !apiKey || !/^https?:\/\//i.test(apiUrl) || !channel.startsWith("$")) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(apiUrl.replace(/\/$/, "") + "/publish", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        channel,
        data,
        ...(idempotencyKey ? { idempotency_key: idempotencyKey.slice(0, 128) } : {})
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      console.error("CENTRIFUGO_PUBLISH_HTTP_" + response.status);
      return false;
    }
    const payload = await response.json().catch(() => null) as {
      error?: { code?: number; message?: string };
      result?: unknown;
    } | null;
    if (!payload || payload.error || !("result" in payload)) {
      console.error("CENTRIFUGO_PUBLISH_REJECTED_" + String(payload?.error?.code || "INVALID_RESPONSE"));
      return false;
    }
    return true;
  } catch {
    console.error("CENTRIFUGO_PUBLISH_UNAVAILABLE");
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

const userRealtimeChannel = (userId: string) => "$server-user:" + userId;
const callRealtimeChannel = (callId: string) => "$server-call:" + callId;

/** Keep best-effort realtime delivery out of the call-setup/ICE response path. */
function deferRealtime(task: Promise<unknown>): void {
  try {
    const runtime = (globalThis as unknown as {
      EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void }
    }).EdgeRuntime;
    if (runtime?.waitUntil) {
      runtime.waitUntil(task.catch(() => undefined));
      return;
    }
  } catch {
    // A local Deno test process may not expose the Supabase EdgeRuntime global.
  }
  void task.catch(() => undefined);
}


const cors = {"access-control-allow-origin":"*","access-control-allow-headers":"authorization,apikey,content-type","access-control-allow-methods":"POST,OPTIONS","content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const out=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const phone=(v:unknown)=>typeof v==="string"&&/^\+[1-9][0-9]{7,14}$/.test(v.trim())?v.trim():null;
const allowed=new Set(["offer","answer","ice","hangup","state"]);
function callTransitionFailure(transition:any){
 const code=String(transition?.error||"CALL_TRANSITION_FAILED");
 const status=code==="CALL_ACCESS_DENIED"?403:code==="CALL_NOT_FOUND"?404:
  code==="CALL_NOT_ANSWERABLE"?409:code==="INVALID_SIGNAL"||code==="INVALID_CALL_TRANSITION"?400:
  code==="PAYLOAD_TOO_LARGE"?413:503;
 return out({error:code,...(transition?.state?{state:transition.state}:{})},status);
}


const SERVER_CALL_TTL_SECONDS = 180;
const GUEST_CALL_TTL_SECONDS = 20 * 60;
const GUEST_INVITE_TTL_SECONDS = 24 * 60 * 60;
const CALL_START_RATE_WINDOW_SECONDS = 60;
const CALL_START_RATE_MAX = 20;
const PRESENCE_FRESH_SECONDS = 35;
const PRESENCE_WRITE_INTERVAL_MS = 12000;

async function touchSessionPresence(db:any, session:any) {
 const lastSeen=Date.parse(session.last_seen_at||"");
 if(Number.isFinite(lastSeen)&&Date.now()-lastSeen<PRESENCE_WRITE_INTERVAL_MS) {
  return session.last_seen_at;
 }
 const now=new Date();
 const nowIso=now.toISOString();
 const writeBefore=new Date(now.getTime()-PRESENCE_WRITE_INTERVAL_MS).toISOString();
 const {error}=await db.from("server_sessions").update({last_seen_at:nowIso})
  .eq("id",session.id).is("revoked_at",null).gt("expires_at",nowIso)
  .lt("last_seen_at",writeBefore);
 if(error)throw new Error("PRESENCE_HEARTBEAT_FAILED");
 session.last_seen_at=nowIso;
 return nowIso;
}
const BASE_ICE_SERVERS = [
 {urls:"stun:stun.cloudflare.com:3478"},
 {urls:"stun:stun.l.google.com:19302"}
];
type IceServerConfig = {
 ice_servers:any[];
 ice_server_mode:"cloudflare-turn"|"coturn-turn"|"stun-only";
};

/**
 * Cloudflare managed TURN is optional. Configure CLOUDFLARE_TURN_KEY_ID and
 * CLOUDFLARE_TURN_API_TOKEN as Edge Function secrets. Short-lived credentials
 * are generated server-side only; neither secret is returned to calling clients.
 * Existing coturn REST configuration remains supported as a fallback.
 */
async function cloudflareTurnIceServers(ttlSeconds:number) {
 const keyId=Deno.env.get("CLOUDFLARE_TURN_KEY_ID")||"";
 const apiToken=Deno.env.get("CLOUDFLARE_TURN_API_TOKEN")||"";
 if(!keyId||!apiToken)return null;
 const ttl=Math.max(300,Math.min(3600,ttlSeconds+120));
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),8000);
 try {
  const response=await fetch(
   "https://rtc.live.cloudflare.com/v1/turn/keys/"+encodeURIComponent(keyId)+"/credentials/generate-ice-servers",
   {
    method:"POST",
    headers:{"authorization":"Bearer "+apiToken,"content-type":"application/json"},
    body:JSON.stringify({ttl}),
    signal:controller.signal
   }
  );
  if(!response.ok) {
   console.error("CLOUDFLARE_TURN_CREDENTIALS_HTTP_"+response.status);
   return null;
  }
  const payload=await response.json();
  const rows=Array.isArray(payload?.iceServers)?payload.iceServers:[];
  const turnRows=rows.filter((row:any)=>{
   const urls=Array.isArray(row?.urls)?row.urls:[row?.urls];
   return urls.some((url:any)=>
    typeof url==="string"&&/^turns?:turn\.cloudflare\.com:/i.test(url)
   )&&typeof row.username==="string"&&row.username.length>0&&
     typeof row.credential==="string"&&row.credential.length>0;
  });
  if(!turnRows.length) {
   console.error("CLOUDFLARE_TURN_RESPONSE_INVALID");
   return null;
  }
  // Our own STUN list remains available even if the provider changes its
  // response shape. Never include Cloudflare's non-TURN rows twice.
  return [...turnRows,...BASE_ICE_SERVERS];
 } catch(_error) {
  console.error("CLOUDFLARE_TURN_CREDENTIALS_UNAVAILABLE");
  return null;
 } finally {
  clearTimeout(timeout);
 }
}

/** Optional coturn REST credentials, retained for self-hosted deployments. */
async function coturnIceServers(identity:string, ttlSeconds:number) {
 const rawUrls=Deno.env.get("SERVER_TURN_URLS")||"";
 const sharedSecret=Deno.env.get("SERVER_TURN_SHARED_SECRET")||"";
 if(!rawUrls||sharedSecret.length<32)return null;
 const turnUrls=rawUrls.split(",").map((url:string)=>url.trim())
  .filter((url:string)=>/^turns?:[^\s@]+$/i.test(url)).slice(0,8);
 if(!turnUrls.length)return null;
 const safeIdentity=identity.replace(/[^A-Za-z0-9_.-]/g,"").slice(0,80)||"server";
 const expires=Math.floor(Date.now()/1000)+Math.max(300,Math.min(3600,ttlSeconds+120));
 const username=expires+":"+safeIdentity;
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(sharedSecret),
  {name:"HMAC",hash:"SHA-1"},false,["sign"]);
 const signature=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(username)));
 const credential=btoa(String.fromCharCode(...signature));
 return [{urls:turnUrls,username,credential},...BASE_ICE_SERVERS];
}

async function iceServersForCall(identity:string, ttlSeconds:number):Promise<IceServerConfig> {
 const cloudflare=await cloudflareTurnIceServers(ttlSeconds);
 if(cloudflare)return {ice_servers:cloudflare,ice_server_mode:"cloudflare-turn"};
 const coturn=await coturnIceServers(identity,ttlSeconds);
 if(coturn)return {ice_servers:coturn,ice_server_mode:"coturn-turn"};
 return {ice_servers:BASE_ICE_SERVERS,ice_server_mode:"stun-only"};
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
 const {data:session,error:sessionError}=await db.from("server_sessions").select("id,user_id,expires_at,last_seen_at").eq("token_hash",sessionHash).is("revoked_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();
 if(sessionError||!session)return out({error:"SESSION_REQUIRED"},401);
 const {data:profile,error:profileError}=await db.from("server_profiles").select("user_id,server_id,display_name,phone_e164,phone_verified_at,allow_number_based_server_calls").eq("user_id",session.user_id).maybeSingle();
 if(profileError||!profile)return out({error:"PROFILE_REQUIRED"},401);
 const uid=profile.user_id; const action=typeof b.action==="string"?b.action:"";
 if(action==="start"&&!profile.display_name)return out({error:"CALLER_NAME_REQUIRED",message:"Set your Server caller name before placing a call."},409);
 try{
  if(action==="realtime_token"){
   const requestedCallId=typeof b.call_id==="string"?b.call_id.trim():"";
   const channels=[userRealtimeChannel(uid)];
   if(requestedCallId){
    const {data:member,error:memberError}=await db.from("server_call_members")
     .select("call_id").eq("call_id",requestedCallId).eq("user_id",uid).maybeSingle();
    if(memberError)return out({error:"CALL_ACCESS_LOOKUP_FAILED"},503);
    if(!member)return out({error:"CALL_ACCESS_DENIED"},403);
    const {data:call,error:callError}=await db.from("server_calls")
     .select("id,state").eq("id",requestedCallId).maybeSingle();
    if(callError)return out({error:"CALL_LOOKUP_FAILED"},503);
    if(!call||!["ringing","connecting","active"].includes(call.state))return out({error:"CALL_NOT_ANSWERABLE"},409);
    channels.push(callRealtimeChannel(requestedCallId));
   }
   const issued=await issueRealtimeToken(uid,channels,900);
   if(!issued)return out({ok:true,realtime_available:false,reason:"CENTRIFUGO_NOT_CONFIGURED"});
   return out({ok:true,realtime_available:true,url:issued.url,token:issued.token,expires_in:900,channels});
  }
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
   const {data,error}=await db.from("server_profiles").select("user_id,server_id,display_name,phone_e164,phone_verified_at,allow_number_based_server_calls,accepted_terms_version,accepted_privacy_version,accepted_legal_at,notifications_enabled,contacts_access_requested,created_at").eq("user_id",uid).maybeSingle();
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
  if(action==="presence"){
   const lastSeenAt=await touchSessionPresence(db,session);
   return out({ok:true,presence:"online",last_seen_at:lastSeenAt,fresh_for_seconds:PRESENCE_FRESH_SECONDS});
  }
  if(action==="availability"){
   // Availability lookups are authenticated and rate-limited. They never claim
   // to know a stranger's mobile-data state from a phone number alone.
   const {data:checkAllowed,error:checkRateError}=await db.rpc("server_rate_limit_allow",{
    p_scope:"recipient_availability",
    p_key_hash:await sha(uid),
    p_window_seconds:60,
    p_max_hits:30
   });
   if(checkRateError)return out({error:"RECIPIENT_AVAILABILITY_RATE_LIMIT_UNAVAILABLE"},503);
   if(checkAllowed!==true)return out({error:"RECIPIENT_AVAILABILITY_RATE_LIMITED",retry_after_seconds:60},429);

   const serverTarget=typeof b.to_server_id==="string"?b.to_server_id.trim().toUpperCase():"";
   const to=phone(b.to_phone);
   if(!serverTarget&&!to)return out({error:"RECIPIENT_REQUIRED"},400);

   let callee:any=null;
   let carrierFallbackPhone:string|null=to;
   let targetKind:"server_id"|"phone"=serverTarget?"server_id":"phone";
   if(serverTarget){
    if(!/^SVR-[0-9A-F]{10}$/.test(serverTarget))return out({error:"INVALID_SERVER_ID"},400);
    const {data:found,error:lookupError}=await db.from("server_profiles")
     .select("user_id,server_id,phone_e164,phone_verified_at,allow_number_based_server_calls")
     .eq("server_id",serverTarget).maybeSingle();
    if(lookupError)return out({error:"SERVER_LOOKUP_FAILED"},503);
    if(!found)return out({error:"SERVER_ID_NOT_FOUND"},404);
    if(found.user_id===uid)return out({error:"CANNOT_CALL_SELF"},400);
    callee=found;
    carrierFallbackPhone=found.phone_verified_at&&found.allow_number_based_server_calls===true?phone(found.phone_e164):null;
   }else{
    if(profile.phone_verified_at&&phone(profile.phone_e164)===to)return out({error:"CANNOT_CALL_SELF"},400);
    const {data:found,error:lookupError}=await db.from("server_profiles")
     .select("user_id,server_id,phone_e164,phone_verified_at,allow_number_based_server_calls")
     .eq("phone_e164",to).maybeSingle();
    if(lookupError)return out({error:"SERVER_LOOKUP_FAILED"},503);
    // A verified number is discoverable through Server only after explicit opt-in.
    callee=found&&found.phone_verified_at&&found.allow_number_based_server_calls===true?found:null;
   }

   if(!callee){
    let guestStatus:"unknown_guest"|"online"|"background_reachable"="unknown_guest";
    let guestLastSeen:string|null=null;
    let guestPushRegistered=false;
    if(to){
     const {data:guestDevices,error:guestDevicesError}=await db.from("server_guest_push_devices")
      .select("last_seen_at,expiration_at").eq("phone_e164",to).is("revoked_at",null).limit(12);
     const now=Date.now();
     const liveGuestDevices=(guestDevices||[]).filter((device:any)=>
      !device.expiration_at||Date.parse(device.expiration_at)>now
     );
     if(!guestDevicesError&&liveGuestDevices.length){
      guestPushRegistered=true;
      const fresh=liveGuestDevices.filter((device:any)=>Number.isFinite(Date.parse(device.last_seen_at||""))&&
       now-Date.parse(device.last_seen_at)<=PRESENCE_FRESH_SECONDS*1000);
      if(fresh.length){
       guestStatus="online";
       guestLastSeen=fresh.sort((a:any,b:any)=>Date.parse(b.last_seen_at)-Date.parse(a.last_seen_at))[0].last_seen_at;
      }else{
       guestStatus="background_reachable";
       guestLastSeen=liveGuestDevices.map((device:any)=>device.last_seen_at).filter(Boolean)
        .sort((a:string,b:string)=>Date.parse(b)-Date.parse(a))[0]||null;
      }
     }
    }
    return out({
     ok:true,
     target_kind:targetKind,
     recipient_availability:{
      status:guestStatus,
      server_reachable:guestStatus==="online",
      internet_status:guestStatus==="online"?"recent_guest_browser_connection":"unknown",
      background_wake_possible:guestPushRegistered,
      last_seen_at:guestLastSeen,
      explanation:guestStatus==="online"
       ?"The recipient's enrolled guest browser recently confirmed internet reachability. Server can send the caller-identified WebRTC invitation to that browser."
       :guestPushRegistered
        ?"The recipient has an enrolled browser call-alert subscription. Server can wake that browser over its current internet connection; delivery and live reachability still need confirmation."
        :"This number has no enrolled guest browser receiver yet. Share one secure invitation so the recipient can enable call alerts on this device."
     }
    });
   }

   const {data:availability,error:availabilityError}=await db.rpc("server_recipient_availability",{
    p_user_id:callee.user_id,
    p_fresh_seconds:PRESENCE_FRESH_SECONDS
   });
   if(availabilityError||!availability)return out({error:"RECIPIENT_AVAILABILITY_UNAVAILABLE"},503);
   const presenceStatus=String(availability.status||"offline");
   const serverReachable=presenceStatus==="online";
   const backgroundPossible=availability.background_wake_possible===true&&presenceStatus==="background_reachable";
   const explanation=serverReachable
    ?"A recent authenticated Server heartbeat confirms that this recipient's Server receiver reached the internet recently. The call can attempt WebRTC; ringing is not guaranteed until they answer."
    :backgroundPossible
     ?"A Server push receiver is registered, but there is no fresh active heartbeat. Server can attempt a background alert; current mobile-data state and ringing are not confirmed."
     :"No recent Server session or registered background receiver is available. This does not prove that the phone's mobile data is switched off.";
   return out({
    ok:true,
    target_kind:targetKind,
    recipient_availability:{
     status:presenceStatus,
     server_reachable:serverReachable,
     internet_status:serverReachable?"recent_server_connection":"unknown",
     background_wake_possible:backgroundPossible,
     last_seen_at:availability.last_seen_at||null,
     explanation
    },
    carrier_fallback:{
     status:carrierFallbackPhone?"user_confirmed_dialer":"unavailable",
     available:!!carrierFallbackPhone,
     destination_e164:carrierFallbackPhone,
     method:"android_action_dial",
     requires_user_confirmation:true
    }
   });
  }
  if(action==="start"){
   const {data:startAllowed,error:rateError}=await db.rpc("server_rate_limit_allow",{
    p_scope:"call_start",p_key_hash:await sha(uid),
    p_window_seconds:CALL_START_RATE_WINDOW_SECONDS,p_max_hits:CALL_START_RATE_MAX
   });
   if(rateError)return out({error:"CALL_START_RATE_LIMIT_UNAVAILABLE"},503);
   if(startAllowed!==true)return out({error:"CALL_START_RATE_LIMITED",retry_after_seconds:CALL_START_RATE_WINDOW_SECONDS},429);
   await touchSessionPresence(db,session);
   const serverTarget=typeof b.to_server_id==="string"?b.to_server_id.trim().toUpperCase():"";
   const to=phone(b.to_phone);
   if(!serverTarget&&!to)return out({error:"RECIPIENT_REQUIRED"},400);
   let callee:any=null;
   let route:"server"|"guest"="guest";
   let recipientPhone:string|null=to;
   let carrierFallbackPhone:string|null=to;
   if(serverTarget){
    if(!/^SVR-[0-9A-F]{10}$/.test(serverTarget))return out({error:"INVALID_SERVER_ID"},400);
    const {data:found,error:lookupError}=await db.from("server_profiles")
      .select("user_id,server_id,phone_e164,phone_verified_at,allow_number_based_server_calls").eq("server_id",serverTarget).maybeSingle();
    if(lookupError)return out({error:"SERVER_LOOKUP_FAILED"},503);
    if(!found)return out({error:"SERVER_ID_NOT_FOUND"},404);
    if(found.user_id===uid)return out({error:"CANNOT_CALL_SELF"},400);
    callee=found;route="server";recipientPhone=phone(found.phone_e164);
    carrierFallbackPhone=found.phone_verified_at&&found.allow_number_based_server_calls===true?phone(found.phone_e164):null;
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
   let recipientAvailability:any={status:"unknown_guest",background_wake_possible:false,last_seen_at:null};
   if(route==="server"){
    const {data:availability,error:availabilityError}=await db.rpc("server_recipient_availability",{
     p_user_id:callee.user_id,p_fresh_seconds:PRESENCE_FRESH_SECONDS
    });
    if(availabilityError||!availability)return out({error:"RECIPIENT_AVAILABILITY_UNAVAILABLE"},503);
    recipientAvailability=availability;
    if(availability.status==="offline"){
     // Offline on Server is an application-presence state, not proof that the
     // handset is unreachable on the carrier network. Persist a missed-call
     // event without enqueueing a push or pretending live ringing began.
     const {data:missed,error:missedError}=await db.rpc("server_create_missed_call_atomic",{
      p_caller_user_id:uid,
      p_callee_user_id:callee.user_id
     });
     if(missedError||!missed?.call)return out({error:"OFFLINE_MISSED_CALL_SAVE_FAILED"},503);
     return out({
      error:"RECIPIENT_NOT_REACHABLE",
      code:"RECIPIENT_OFFLINE",
      message:"This Server user is offline on Server. A missed-call entry has been saved to their Server inbox and will appear when they reconnect. You can also try their verified number through your normal phone SIM.",
      call_created:true,
      missed_call_saved:true,
      call_id:missed.call.id,
      call:missed.call,
      recipient_availability:availability,
      carrier_fallback:{status:carrierFallbackPhone?"user_confirmed_dialer":"unavailable",available:!!carrierFallbackPhone,destination_e164:carrierFallbackPhone,method:"android_action_dial",requires_user_confirmation:true}
     },409);
    }
   }
   const now=new Date().toISOString();
   const callTtlSeconds=route==="guest"?GUEST_CALL_TTL_SECONDS:SERVER_CALL_TTL_SECONDS;
   const expiresAt=new Date(Date.now()+callTtlSeconds*1000).toISOString();
   // Generate the guest token before the database transaction so the call,
   // participant rows and hashed one-call invite are committed together.
   const guestToken=route==="guest"
    ?Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("")
    :null;
   if(route==="guest"&&!to)return out({error:"RECIPIENT_PHONE_REQUIRED"},400);
   const guestTokenHash=guestToken?await sha(guestToken):null;
   const guestInviteExpiresAt=guestToken?new Date(Date.now()+GUEST_INVITE_TTL_SECONDS*1000).toISOString():null;
   const {data:created,error:ce}=await db.rpc("server_create_call_atomic",{
    p_caller_user_id:uid,
    p_callee_user_id:callee?.user_id||null,
    p_callee_phone_e164:recipientPhone,
    p_route:route,
    p_expires_at:expiresAt,
    p_invite_phone_e164:route==="guest"?to:null,
    p_invite_token_hash:guestTokenHash,
    p_invite_expires_at:guestInviteExpiresAt
   });
   if(ce||!created?.call)return out({error:"CALL_CREATE_FAILED"},503);
   const call=created.call;
   if(route==="server"){
    const callerLabel=profile.display_name;
    deferRealtime(publishRealtime(userRealtimeChannel(callee.user_id),{
     type:"incoming_call",
     call:{id:call.id,state:call.state,route:call.route,created_at:call.created_at,expires_at:call.expires_at},
     caller:{label:callerLabel,display_name:profile.display_name,server_id:profile.server_id}
    },"incoming:"+call.id));
   }
   const iceConfig=await iceServersForCall(call.id,callTtlSeconds);
   const callIceServers=iceConfig.ice_servers;
   // Call creation has already committed a durable PGMQ delivery job with
   // the call and membership rows. Never block this request on FCM/APNs.
   const pushDelivery:any=route==="server"
    ?{queued:created.delivery_queued===true,accepted_by_provider:false,reason:"BACKGROUND_DELIVERY_PENDING"}
    :{queued:false,configured:false,reason:"NOT_A_SERVER_USER"};
   if(route==="guest"){
    const token=guestToken as string;
    const expires=guestInviteExpiresAt as string;
    // This endpoint returns caller-specific Open Graph metadata and redirects
   // the recipient to the secure browser call. The link is sent by the selected
   // first-contact transport below when an eligible route is configured.
   const callerPhone=profile.phone_verified_at&&profile.allow_number_based_server_calls===true?phone(profile.phone_e164):null;
   const callerDisplay=profile.display_name;
   const invitationUrl="https://hzuovekqsjtpvmbuybxs.supabase.co/functions/v1/server-guest-preview?token="+encodeURIComponent(token);
   const invitationText=callerDisplay+" is calling: "+invitationUrl;
   const guestBrowserUrl="https://server-onboarding-ochre.vercel.app/guest.html#token="+encodeURIComponent(token);
   const guestPush=await sendGuestBrowserPush(db,to,{
    call_id:call.id,caller_label:callerDisplay,
    title:callerDisplay+" is calling you",
    body:callerDisplay+" is calling you through Server. Tap to open the caller-identifying invitation and answer by internet voice.",
    url:guestBrowserUrl
   });
   const hasPushAccepted=guestPush.accepted>0;
   const guestAvailabilityStatus=guestPush.recent_online>0?"online":
    guestPush.registered>0?"background_reachable":"unknown_guest";

   // First-contact transport order: enrolled browser push, hosted TextBee pilot,
   // then the caller-owned Server SIM gateway. Never send a second SMS after
   // TextBee reports an ambiguous timeout/5xx result.
   let simSmsQueued=false;
   let simSmsGatewayOnline=false;
   let textBeeAccepted=false;
   let textBeeBatchId:string|null=null;
   let textBeeOutcome:"disabled"|"accepted"|"rejected"|"uncertain"="disabled";
   if(!hasPushAccepted){
    const {data:pairAllowed,error:pairLimitError}=await db.rpc("server_rate_limit_allow",{
     p_scope:"guest_invite_sms_pair",
     p_key_hash:await sha("guest-invite-sms-pair:"+uid+":"+to),
     p_window_seconds:3600,p_max_hits:3
    });
    const {data:senderAllowed,error:senderLimitError}=await db.rpc("server_rate_limit_allow",{
     p_scope:"guest_invite_sms_sender",
     p_key_hash:await sha("guest-invite-sms-sender:"+uid),
     p_window_seconds:3600,p_max_hits:20
    });
    if(!pairLimitError&&!senderLimitError&&pairAllowed===true&&senderAllowed===true){
     const textBee=await sendTextBeeSms({recipient:to,message:invitationText});
     textBeeOutcome=textBee.outcome;
     if(textBee.outcome==="accepted"){
      textBeeAccepted=true;
      textBeeBatchId=textBee.smsBatchId;
     }else if(textBee.outcome!=="uncertain"){
      // TextBee is disabled or explicitly rejected the request. The independent
      // caller-owned SIM gateway remains available as a no-aggregator fallback.
      const gatewayFreshAfter=new Date(Date.now()-90000).toISOString();
      const {data:gateway,error:gatewayError}=await db.from("server_gateway_devices")
       .select("id").eq("owner_user_id",uid).eq("enabled",true)
       .gte("last_seen_at",gatewayFreshAfter)
       .order("last_seen_at",{ascending:false}).limit(1).maybeSingle();
      if(gatewayError){
       console.warn("GUEST_SIM_GATEWAY_LOOKUP_FAILED");
      }else if(gateway){
       simSmsGatewayOnline=true;
       const {data:queuedJob,error:queueError}=await db.from("server_sms_jobs").insert({
        category:"guest_invite",
        recipient_e164:to,
        body:invitationText,
        call_id:call.id,
        guest_invite_id:created.invite_id,
        source_event_id:"server-guest-invite:"+call.id,
        status:"queued"
       }).select("id").maybeSingle();
       if(!queueError&&queuedJob){
        simSmsQueued=true;
       }else{
        console.warn("GUEST_SIM_SMS_QUEUE_FAILED");
       }
      }
     }
    }else{
     console.warn("GUEST_SIM_SMS_RATE_LIMITED_OR_UNAVAILABLE");
    }
   }

   const deliveryMode=hasPushAccepted?"web_push":textBeeAccepted?"textbee_sms_accepted":
    simSmsQueued?"sim_sms_queued":textBeeOutcome==="uncertain"?"textbee_send_unknown":"manual_share";
   const deliveryMessage=hasPushAccepted
    ?"Server submitted a caller-identified browser call alert to "+guestPush.accepted+" registered device(s). Push-service acceptance is not proof that the notification has appeared; the guest browser confirms when it opens."
    :textBeeAccepted
     ?"TextBee accepted the caller-identified SMS invitation for sending. Check the TextBee message status for carrier delivery; API acceptance is not proof that the recipient received it."
     :simSmsQueued
      ?"TextBee did not accept the request. Server queued the caller-identified invitation on your linked Android SIM gateway; your mobile plan may charge for this SMS. Queueing is not proof of delivery."
      :textBeeOutcome==="uncertain"
       ?"The TextBee request timed out or returned an uncertain server error. Server did not send a second SMS to avoid duplicate invitations. Check TextBee message history before retrying."
       :"No enrolled browser receiver or available SMS gateway accepted the invitation. Share this caller-identifying invitation manually or configure TextBee.";
   return out({
    ok:true,call_id:call.id,route,ice_servers:callIceServers,ice_server_mode:iceConfig.ice_server_mode,call,
    invite_expires_at:expires,delivery_mode:deliveryMode,delivery_channel:deliveryMode,
    guest_invite_url:invitationUrl,invitation_text:invitationText,
    delivery_message:deliveryMessage,
    caller_display_label:callerDisplay,caller_display_name:callerDisplay,caller_phone_e164:callerPhone||"",
    recipient_availability:{
     status:guestAvailabilityStatus,connected:guestPush.recent_online>0,
     internet_status:guestAvailabilityStatus==="online"?"recent_guest_browser_connection":"unknown",
     background_wake_possible:guestPush.registered>0,
     explanation:guestAvailabilityStatus==="online"
      ?"The guest browser recently confirmed its internet connection."
      :guestPush.registered>0
       ?"A browser push receiver is registered; waiting for the recipient to open and confirm this call."
       :"The recipient has not enrolled a guest browser receiver yet."
    },
    textbee_delivery:{
     channel:"textbee",outcome:textBeeOutcome,accepted:textBeeAccepted,
     sms_batch_id:textBeeBatchId,device_delivery_confirmed:false
    },
    sim_sms_delivery:{
     channel:"caller_sim_sms",queued:simSmsQueued,gateway_online:simSmsGatewayOnline,
     carrier_charges_possible:true,device_delivery_confirmed:false
    },
    push_delivery:{
     channel:"web_push",registered_devices:guestPush.registered,
     accepted_by_push_service:guestPush.accepted,failed:guestPush.failed,
     device_delivery_confirmed:false,configured:guestPush.configured
    }
   });
   }
   return out({
    ok:true,call_id:call.id,route,call,ice_servers:callIceServers,ice_server_mode:iceConfig.ice_server_mode,
    recipient_availability:recipientAvailability,
    carrier_fallback:{status:carrierFallbackPhone?"user_confirmed_dialer":"unavailable",available:!!carrierFallbackPhone,destination_e164:carrierFallbackPhone,method:"android_action_dial",requires_user_confirmation:true},
    push_delivery:pushDelivery
   });
  }
  if(action==="incoming"){
   await touchSessionPresence(db,session);
   const {data:incoming,error:incomingError}=await db.from("server_calls").select("id,state,route,caller_user_id,created_at,updated_at,carrier_fallback_method,carrier_fallback_status,carrier_fallback_sim_slot,carrier_fallback_carrier,carrier_fallback_requested_at,carrier_fallback_handed_off_at,carrier_fallback_failed_at,carrier_fallback_error_code").eq("callee_user_id",uid).in("state",["ringing","connecting","missed"]).or("state.eq.missed,expires_at.gt."+new Date().toISOString()).gte("updated_at",new Date(Date.now()-14*24*60*60*1000).toISOString()).order("created_at",{ascending:false}).limit(40);
   if(incomingError)return out({error:"INCOMING_CALL_POLL_FAILED"},503);
   const ids=(incoming||[]).map((x:any)=>x.caller_user_id);
   const {data:profiles,error:profilesError}=ids.length?await db.from("server_profiles")
     .select("user_id,display_name,phone_e164,phone_verified_at,allow_number_based_server_calls,server_id").in("user_id",ids):{data:[],error:null};
   if(profilesError)return out({error:"CALLER_PROFILE_LOOKUP_FAILED"},503);
   const rows=new Map((profiles||[]).map((p:any)=>[p.user_id,p]));
   return out({calls:(incoming||[]).map((c:any)=>{
    const caller:any=rows.get(c.caller_user_id)||{};
    // Never disclose a stored phone number to the callee unless the owner
    // verified it and explicitly opted into number-based Server calls.
    const sharedPhone=caller.phone_verified_at&&caller.allow_number_based_server_calls===true?phone(caller.phone_e164):null;
    return {id:c.id,state:c.state,route:c.route,caller_phone_e164:sharedPhone||"",caller_display_name:caller.display_name||"SERVER CALLER",caller_label:caller.display_name||"SERVER CALLER",caller_server_id:caller.server_id||"",created_at:c.created_at,updated_at:c.updated_at,carrier_fallback_method:c.carrier_fallback_method||null,carrier_fallback_status:c.carrier_fallback_status||null,carrier_fallback_sim_slot:c.carrier_fallback_sim_slot??null,carrier_fallback_carrier:c.carrier_fallback_carrier||null,carrier_fallback_requested_at:c.carrier_fallback_requested_at||null,carrier_fallback_handed_off_at:c.carrier_fallback_handed_off_at||null,carrier_fallback_failed_at:c.carrier_fallback_failed_at||null,carrier_fallback_error_code:c.carrier_fallback_error_code||null};
   })});
  }
  if(action==="record_carrier_fallback"){
   const callId=typeof b.call_id==="string"?b.call_id.trim():"";
   const stage=typeof b.stage==="string"?b.stage:"";
   const allowedStages=new Set(["requested","handed_off","failed","unavailable"]);
   if(!callId||!allowedStages.has(stage))return out({error:"INVALID_CARRIER_FALLBACK_EVENT"},400);
   const slot=b.selected_sim_slot===null||b.selected_sim_slot===undefined?null:Number(b.selected_sim_slot);
   if(slot!==null&&(!Number.isInteger(slot)||slot<0||slot>8))return out({error:"INVALID_SELECTED_SIM_SLOT"},400);
   const carrier=typeof b.selected_sim_carrier==="string"?b.selected_sim_carrier.trim().slice(0,80):"";
   const errorCode=typeof b.error_code==="string"&&/^[A-Z0-9_]{1,64}$/.test(b.error_code)?b.error_code:null;
   const {data:existing,error:lookupError}=await db.from("server_calls")
    .select("id,caller_user_id,carrier_fallback_status").eq("id",callId).maybeSingle();
   if(lookupError)return out({error:"CARRIER_FALLBACK_LOOKUP_FAILED"},503);
   if(!existing||existing.caller_user_id!==uid)return out({error:"CALL_ACCESS_DENIED"},403);
   if(existing.carrier_fallback_status==="handed_off"&&stage!=="handed_off"){
    return out({ok:true,already_recorded:true,carrier_fallback_status:"handed_off"});
   }
   if(existing.carrier_fallback_status===stage){
    return out({ok:true,already_recorded:true,carrier_fallback_status:stage});
   }
   const now=new Date().toISOString();
   const patch:any={
    carrier_fallback_method:"selected_sim",
    carrier_fallback_status:stage,
    carrier_fallback_sim_slot:slot,
    carrier_fallback_carrier:carrier||null,
    updated_at:now
   };
   if(stage==="requested"){
    patch.carrier_fallback_requested_at=now;
    patch.carrier_fallback_handed_off_at=null;
    patch.carrier_fallback_failed_at=null;
    patch.carrier_fallback_error_code=null;
   }else if(stage==="handed_off"){
    patch.carrier_fallback_requested_at=now;
    patch.carrier_fallback_handed_off_at=now;
    patch.carrier_fallback_failed_at=null;
    patch.carrier_fallback_error_code=null;
   }else if(stage==="failed"||stage==="unavailable"){
    patch.carrier_fallback_requested_at=now;
    patch.carrier_fallback_handed_off_at=null;
    patch.carrier_fallback_failed_at=now;
    patch.carrier_fallback_error_code=errorCode||"CARRIER_FALLBACK_FAILED";
   }
   const {data:saved,error:saveError}=await db.from("server_calls").update(patch)
    .eq("id",callId).eq("caller_user_id",uid)
    .select("id,carrier_fallback_method,carrier_fallback_status,carrier_fallback_sim_slot,carrier_fallback_carrier,carrier_fallback_requested_at,carrier_fallback_handed_off_at,carrier_fallback_failed_at,carrier_fallback_error_code")
    .maybeSingle();
   if(saveError||!saved)return out({error:"CARRIER_FALLBACK_RECORD_FAILED"},503);
   return out({ok:true,call:saved});
  }
  if(action==="poll"){
   const callId=typeof b.call_id==="string"?b.call_id:"";
   if(callId){
    const {data:member,error:memberError}=await db.from("server_call_members").select("call_id").eq("call_id",callId).eq("user_id",uid).maybeSingle();
    if(memberError)return out({error:"CALL_ACCESS_LOOKUP_FAILED"},503);
    if(!member)return out({error:"CALL_ACCESS_DENIED"},403);
   }
   let q=db.from("server_calls").select("id,state,route,created_at,updated_at,expires_at,carrier_fallback_method,carrier_fallback_status,carrier_fallback_sim_slot,carrier_fallback_carrier,carrier_fallback_requested_at,carrier_fallback_handed_off_at,carrier_fallback_failed_at,carrier_fallback_error_code").or("caller_user_id.eq."+uid+",callee_user_id.eq."+uid).order("created_at",{ascending:false}).limit(30);
   if(callId)q=q.eq("id",callId);
   const {data:calls,error}=await q;if(error)return out({error:"CALL_POLL_FAILED"},503);
   let signals:unknown[]=[];
   const after=Number.isSafeInteger(b.after_seq)&&Number(b.after_seq)>=0?Number(b.after_seq):0;
   let nextAfterSeq=after;
   if(callId){
    const {data:s,error:se}=await db.from("server_call_signals").select("seq,from_user_id,kind,payload,created_at").eq("call_id",callId).gt("seq",after).order("seq",{ascending:true}).limit(100);
    if(se)return out({error:"SIGNAL_POLL_FAILED"},503);
    const rows=s||[];
    signals=rows.filter((x:any)=>x.from_user_id!==uid);
    if(rows.length)nextAfterSeq=Number(rows[rows.length-1].seq)||after;
   }
   const call=callId?(calls||[]).find((x:any)=>x.id===callId)||null:null;
   return out({calls:calls||[],call,signals,next_after_seq:nextAfterSeq});
  }
  if(action==="answer"||action==="accept"||action==="hangup"||action==="end"||action==="set_active"){
   const callId=typeof b.call_id==="string"?b.call_id:"";
   if(!callId)return out({error:"CALL_ID_REQUIRED"},400);
   const transitionAction=(action==="answer"||action==="accept")?"answer":
    (action==="set_active"?"set_active":"end");
   const {data:transition,error:transitionError}=await db.rpc("server_call_transition_atomic",{
    p_call_id:callId,p_user_id:uid,p_action:transitionAction,p_kind:null,p_payload:{}
   });
   if(transitionError||!transition)return out({error:"CALL_TRANSITION_FAILED"},503);
   if(transition.error)return callTransitionFailure(transition);
   deferRealtime(publishRealtime(callRealtimeChannel(callId),{
    type:"call_state",call_id:callId,state:transition.state||transition.call?.state||"connecting",
    action:transitionAction,seq:transition.seq||null
   },callId+":"+transitionAction+":"+(transition.seq||"state")));
   if(transitionAction==="answer"){
    const expiresAt=Date.parse(transition.call?.expires_at||"");
    const ttl=Number.isFinite(expiresAt)?Math.max(300,Math.ceil((expiresAt-Date.now())/1000)):SERVER_CALL_TTL_SECONDS;
    const iceConfig=await iceServersForCall(callId,ttl);
    return out({ok:true,state:"connecting",ice_servers:iceConfig.ice_servers,ice_server_mode:iceConfig.ice_server_mode});
   }
   return out({ok:true,state:transition.state,seq:transition.seq,already_ended:transition.already_ended===true});
  }
  if(action==="signal"){
   const callId=typeof b.call_id==="string"?b.call_id:"";
   const kind=typeof b.kind==="string"?b.kind:"";
   const payload=b.payload&&typeof b.payload==="object"&&!Array.isArray(b.payload)?b.payload:{};
   if(!callId||!allowed.has(kind))return out({error:"INVALID_SIGNAL"},400);
   if(JSON.stringify(payload).length>18000)return out({error:"PAYLOAD_TOO_LARGE"},413);
   const {data:transition,error:transitionError}=await db.rpc("server_call_transition_atomic",{
    p_call_id:callId,p_user_id:uid,p_action:"signal",p_kind:kind,p_payload:payload
   });
   if(transitionError||!transition)return out({error:"SIGNAL_SAVE_FAILED"},503);
   if(transition.error)return callTransitionFailure(transition);
   deferRealtime(publishRealtime(callRealtimeChannel(callId),{
    type:"signal",call_id:callId,seq:transition.seq,kind,payload,
    from_user_id:uid,from_server_id:profile.server_id,created_at:transition.created_at,state:transition.state
   },callId+":"+transition.seq));
   return out({ok:true,seq:transition.seq,created_at:transition.created_at,state:transition.state});
  }
  if(action==="ice_servers"){
   const callId=typeof b.call_id==="string"?b.call_id:"";
   if(!callId)return out({error:"CALL_ID_REQUIRED"},400);
   const {data:member,error:memberError}=await db.from("server_call_members")
    .select("call_id").eq("call_id",callId).eq("user_id",uid).maybeSingle();
   if(memberError)return out({error:"CALL_ACCESS_LOOKUP_FAILED"},503);
   if(!member)return out({error:"CALL_ACCESS_DENIED"},403);
   const {data:call,error:callError}=await db.from("server_calls")
    .select("id,state,expires_at").eq("id",callId).maybeSingle();
   if(callError)return out({error:"CALL_LOOKUP_FAILED"},503);
   if(!call||!["ringing","connecting","active"].includes(call.state)||
      (call.expires_at&&Date.parse(call.expires_at)<=Date.now()))return out({error:"CALL_NOT_ANSWERABLE"},409);
   const remaining=call.expires_at?Math.max(300,Math.ceil((Date.parse(call.expires_at)-Date.now())/1000)):SERVER_CALL_TTL_SECONDS;
   const iceConfig=await iceServersForCall(callId,remaining);
   return out({ice_servers:iceConfig.ice_servers,ice_server_mode:iceConfig.ice_server_mode});
  }
  return out({error:"UNKNOWN_ACTION"},400);
 }catch{return out({error:"SERVER_CALLS_INTERNAL_ERROR"},500);}
});