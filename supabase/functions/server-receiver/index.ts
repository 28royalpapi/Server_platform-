import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const cors={"access-control-allow-origin":"*","access-control-allow-headers":"authorization,apikey,content-type,x-server-session-token","access-control-allow-methods":"POST,OPTIONS","content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const out=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:cors});
const sha=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,"0")).join("");
function client(){
 const url=Deno.env.get("SUPABASE_URL")||"";
 let key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SUPABASE_SECRET_KEY")||"";
 if(!key){try{const values=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");key=values.default||Object.values(values)[0]||"";}catch{}}
 if(!url||!key)throw new Error("SERVER_NOT_CONFIGURED");
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
function validPushEndpoint(value:unknown):value is string{
 if(typeof value!=="string"||value.length>2048)return false;
 try{const u=new URL(value),host=u.hostname.toLowerCase();return u.protocol==="https:"&&(
  host==="fcm.googleapis.com"||host==="push.services.mozilla.com"||host.endsWith(".push.services.mozilla.com")||
  host==="web.push.apple.com"||host==="push.apple.com"||host.endsWith(".push.apple.com"));}catch{return false;}
}
const phoneHint=(phone:string)=>"ending in "+phone.slice(-4);
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return out({error:"METHOD_NOT_ALLOWED"},405);
 let b:any;try{b=await req.json();if(!b||typeof b!=="object"||Array.isArray(b))throw 0;}catch{return out({error:"INVALID_JSON"},400);}
 let db:any;try{db=client();}catch{return out({error:"SERVER_NOT_CONFIGURED"},503);}
 const action=typeof b.action==="string"?b.action:"";

 // The private Receiver manager shares the existing Server device-session
 // contract. Session tokens are hashed at rest in server_sessions.
 if(action==="create_invites"||action==="list"){
  const sessionToken=(req.headers.get("x-server-session-token")||
   (req.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]||"").trim();
  if(!/^[0-9a-f]{64}$/.test(sessionToken))return out({error:"SESSION_REQUIRED"},401);
  const sessionHash=await sha(sessionToken);
  const {data:session,error:sessionError}=await db.from("server_sessions")
   .select("id,user_id,expires_at").eq("token_hash",sessionHash).is("revoked_at",null)
   .gt("expires_at",new Date().toISOString()).maybeSingle();
  if(sessionError||!session)return out({error:"SESSION_REQUIRED"},401);
  const {data:profile,error:profileError}=await db.from("server_profiles")
   .select("user_id,server_id,display_name,phone_e164,phone_verified_at,allow_number_based_server_calls")
   .eq("user_id",session.user_id).maybeSingle();
  if(profileError||!profile)return out({error:"PROFILE_REQUIRED"},401);
  const ownerId=profile.user_id;
  const callerLabel=(typeof profile.display_name==="string"&&profile.display_name.trim())
   ?profile.display_name.trim():(profile.server_id||"SERVER USER");

  if(action==="list"){
   const {data:invites,error:invitesError}=await db.from("server_receiver_invites")
    .select("id,phone_e164,expires_at,claimed_at,revoked_at,created_at,caller_label")
    .eq("created_by_user_id",ownerId).order("created_at",{ascending:false}).limit(500);
   if(invitesError)return out({error:"RECEIVER_REGISTRY_LOOKUP_FAILED"},503);
   const rows=invites||[];
   const phones=[...new Set(rows.map((row:any)=>row.phone_e164).filter(Boolean))];
   let devices:any[]=[];
   if(phones.length){
    const {data,error}=await db.from("server_guest_push_devices")
     .select("phone_e164,last_seen_at,expiration_at,revoked_at")
     .in("phone_e164",phones).is("revoked_at",null);
    if(error)return out({error:"RECEIVER_DEVICE_LOOKUP_FAILED"},503);
    devices=(data||[]).filter((d:any)=>!d.expiration_at||Date.parse(d.expiration_at)>Date.now());
   }
   const latest=new Map<string,any>();
   for(const row of rows){
    if(!latest.has(row.phone_e164))latest.set(row.phone_e164,row);
   }
   const activeByPhone=new Map<string,any[]>();
   for(const device of devices){
    const list=activeByPhone.get(device.phone_e164)||[];
    list.push(device);activeByPhone.set(device.phone_e164,list);
   }
   const receivers=[...latest.values()].map((row:any)=>{
    const active=activeByPhone.get(row.phone_e164)||[];
    const status=active.length?"registered":row.revoked_at?"revoked":
     row.claimed_at?"needs_attention":
     (row.expires_at&&Date.parse(row.expires_at)<=Date.now())?"expired":"pending";
    const lastConnected=active.map((d:any)=>d.last_seen_at).filter(Boolean).sort().at(-1)||null;
    return {
     receiver_id:row.id,phone_e164:row.phone_e164,status,
     created_at:row.created_at,expires_at:row.expires_at,
     claimed_at:row.claimed_at,last_connected_at:lastConnected,
     active_device_count:active.length
    };
   });
   return out({ok:true,receiver_count:receivers.length,
    registered_count:receivers.filter((r:any)=>r.status==="registered").length,
    pending_count:receivers.filter((r:any)=>r.status==="pending").length,
    attention_count:receivers.filter((r:any)=>["expired","revoked","needs_attention"].includes(r.status)).length,
    receivers});
  }

  if(!Array.isArray(b.recipients)||b.recipients.length<1||b.recipients.length>20)
   return out({error:"RECIPIENTS_MUST_BE_1_TO_20"},400);
  const recipients:string[]=[];
  for(const raw of b.recipients){
   if(typeof raw!=="string"||!/^\+[1-9][0-9]{7,14}$/.test(raw.trim()))
    return out({error:"INVALID_RECIPIENT_PHONE"},400);
   recipients.push(raw.trim());
  }
  if(new Set(recipients).size!==recipients.length)return out({error:"DUPLICATE_RECIPIENTS"},400);
  const callerPhone=profile.phone_verified_at?profile.phone_e164:null;
  if(callerPhone&&recipients.includes(callerPhone))return out({error:"CANNOT_INVITE_SELF"},400);

  const since=new Date(Date.now()-24*60*60*1000).toISOString();
  const {count:recentCount,error:limitError}=await db.from("server_receiver_invites")
   .select("id",{count:"exact",head:true}).eq("created_by_user_id",ownerId).gte("created_at",since);
  if(limitError)return out({error:"RECEIVER_INVITE_LIMIT_CHECK_FAILED"},503);
  if((recentCount||0)+recipients.length>80)
   return out({error:"RECEIVER_INVITE_DAILY_LIMIT",daily_limit:80,already_created:recentCount||0},429);

  const {data:knownProfiles,error:knownError}=await db.from("server_profiles")
   .select("phone_e164,phone_verified_at,allow_number_based_server_calls")
   .in("phone_e164",recipients);
  if(knownError)return out({error:"RECIPIENT_LOOKUP_FAILED"},503);
  const knownServer=new Set((knownProfiles||[])
   .filter((row:any)=>row.phone_verified_at&&row.allow_number_based_server_calls===true)
   .map((row:any)=>row.phone_e164));

  const {data:deviceRows,error:deviceError}=await db.from("server_guest_push_devices")
   .select("phone_e164,expiration_at").in("phone_e164",recipients).is("revoked_at",null);
  if(deviceError)return out({error:"RECEIVER_DEVICE_LOOKUP_FAILED"},503);
  const registered=new Set((deviceRows||[])
   .filter((row:any)=>!row.expiration_at||Date.parse(row.expiration_at)>Date.now())
   .map((row:any)=>row.phone_e164));

  const results:any[]=[];
  for(const to of recipients){
   if(knownServer.has(to)){
    results.push({phone_e164:to,status:"server_user",message:"This number already belongs to a discoverable Server user. Call their Server identity."});
    continue;
   }
   if(registered.has(to)){
    results.push({phone_e164:to,status:"registered",message:"This number already has an active Server browser receiver. You can call it without sending another setup link."});
    continue;
   }

   const now=new Date().toISOString();
   // Replacing a still-pending invitation invalidates the old link. A new link
   // is created only when the caller explicitly asks to enrol/share again.
   await db.from("server_receiver_invites").update({revoked_at:now})
    .eq("created_by_user_id",ownerId).eq("phone_e164",to)
    .is("claimed_at",null).is("revoked_at",null);

   const token=Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((x)=>x.toString(16).padStart(2,"0")).join("");
   // Pending Receiver links have no time-based expiry. They remain one-use and
   // can be revoked by the caller until the recipient explicitly claims them.
   const expiresAt=null;
   const {data:created,error:createError}=await db.from("server_receiver_invites").insert({
    token_hash:await sha(token),created_by_user_id:ownerId,phone_e164:to,
    caller_label:callerLabel.slice(0,80),expires_at:expiresAt
   }).select("id,expires_at").single();
   if(createError||!created){
    results.push({phone_e164:to,status:"failed",message:"Could not create this receiver invitation."});
    continue;
   }
   const url="https://server-onboarding-ochre.vercel.app/receiver.html#token="+encodeURIComponent(token);
   results.push({
    phone_e164:to,status:"invitation_created",receiver_invite_id:created.id,
    expires_at:created.expires_at,invitation_url:url,
    invitation_text:"SERVER RECEIVER SETUP\n"+callerLabel+
     " invited this phone to receive Server internet calls.\n"+
     "Open this link once and tap Enable call alerts. After that, Server can call this number without you setting it up again.\n"+url
   });
  }
  const createdCount=results.filter((r:any)=>r.status==="invitation_created").length;
  return out({
   ok:true,requested_count:recipients.length,
   invitation_count:createdCount,
   registered_count:results.filter((r:any)=>r.status==="registered").length,
   server_user_count:results.filter((r:any)=>r.status==="server_user").length,
   failed_count:results.filter((r:any)=>r.status==="failed").length,
   carrier_sms_used:false,results
  });
 }
 // A device secret is a durable, per-browser credential. It lets a previously
 // enrolled Receiver repair an expired or rotated browser push subscription
 // without consuming another one-time invitation. Explicitly revoked devices
 // cannot renew because every lookup below requires revoked_at IS NULL.
 if(action==="renew_config"||action==="renew"){
  const deviceSecret=typeof b.device_secret==="string"?b.device_secret:"";
  if(!/^[0-9a-f]{64}$/i.test(deviceSecret))
   return out({error:"RECEIVER_DEVICE_CREDENTIALS_INVALID"},400);
  const secretHash=await sha(deviceSecret);
  const {data:devices,error:deviceError}=await db.from("server_guest_push_devices")
   .select("id,phone_e164,expiration_at,receiver_invite_id")
   .eq("receiver_secret_hash",secretHash).is("revoked_at",null).limit(2);
  if(deviceError)return out({error:"RECEIVER_DEVICE_LOOKUP_FAILED"},503);
  if(!devices||devices.length===0)return out({error:"RECEIVER_DEVICE_NOT_RENEWABLE"},404);
  if(devices.length!==1)return out({error:"RECEIVER_DEVICE_CREDENTIAL_AMBIGUOUS"},409);
  const device=devices[0];
  if(action==="renew_config"){
   const {data:keys,error:keysError}=await db.from("server_guest_push_config")
    .select("public_key").eq("id",1).maybeSingle();
   if(keysError||!keys?.public_key)return out({error:"RECEIVER_PUSH_CONFIGURATION_UNAVAILABLE"},503);
   return out({ok:true,vapid_public_key:keys.public_key,phone_hint:phoneHint(device.phone_e164)});
  }
  if(b.consent!==true)return out({error:"RECEIVER_CONSENT_REQUIRED"},400);
  const subscription=b.subscription,endpoint=subscription?.endpoint,p256dh=subscription?.keys?.p256dh,auth=subscription?.keys?.auth;
  if(!validPushEndpoint(endpoint)||typeof p256dh!=="string"||!/^[A-Za-z0-9_-]{80,160}$/.test(p256dh)||
     typeof auth!=="string"||!/^[A-Za-z0-9_-]{16,80}$/.test(auth))
   return out({error:"RECEIVER_SUBSCRIPTION_INVALID"},400);
  const {data:bound,error:boundError}=await db.from("server_guest_push_devices")
   .select("id,phone_e164").eq("endpoint",endpoint).is("revoked_at",null).maybeSingle();
  if(boundError)return out({error:"RECEIVER_DEVICE_LOOKUP_FAILED"},503);
  if(bound&&bound.id!==device.id)
   return out({error:"RECEIVER_DEVICE_ALREADY_BOUND",message:"This browser subscription is already connected to another Receiver. Turn off that Receiver first."},409);
  const expiry=Number(subscription.expirationTime);
  const expirationAt=Number.isFinite(expiry)&&expiry>Date.now()?new Date(expiry).toISOString():null;
  const now=new Date().toISOString();
  const {data:updated,error:updateError}=await db.from("server_guest_push_devices").update({
   endpoint,p256dh,auth,expiration_at:expirationAt,last_seen_at:now,updated_at:now
  }).eq("id",device.id).eq("receiver_secret_hash",secretHash).is("revoked_at",null)
   .select("id").maybeSingle();
  if(updateError){
   if(updateError.code==="23505")return out({error:"RECEIVER_DEVICE_ALREADY_BOUND"},409);
   return out({error:"RECEIVER_SUBSCRIPTION_RENEW_FAILED"},503);
  }
  if(!updated)return out({error:"RECEIVER_DEVICE_NOT_RENEWABLE"},409);
  return out({ok:true,registered:true,renewed:true,phone_hint:phoneHint(device.phone_e164)});
 }
 // Per-device secret permits status, heartbeat and revocation. Only its hash is stored.
 if(["status","presence","revoke"].includes(action)){
  const endpoint=b.endpoint,secret=typeof b.device_secret==="string"?b.device_secret:"";
  if(!validPushEndpoint(endpoint)||!/^[0-9a-f]{64}$/i.test(secret))return out({error:"RECEIVER_DEVICE_CREDENTIALS_INVALID"},400);
  const secretHash=await sha(secret),now=new Date().toISOString();
  if(action==="revoke"){
   const {data,error}=await db.from("server_guest_push_devices").update({revoked_at:now,updated_at:now})
    .eq("endpoint",endpoint).eq("receiver_secret_hash",secretHash).is("revoked_at",null)
    .select("id,receiver_invite_id").maybeSingle();
   if(error)return out({error:"RECEIVER_REVOKE_FAILED"},503);
   if(data?.id){
    const {error:nativeRevokeError}=await db.from("server_receiver_native_devices")
     .update({revoked_at:now,updated_at:now}).eq("receiver_device_id",data.id).is("revoked_at",null);
    if(nativeRevokeError)return out({error:"RECEIVER_NATIVE_REVOKE_SYNC_FAILED"},503);
   }
   if(data?.receiver_invite_id){
    const {error:inviteRevokeError}=await db.from("server_receiver_invites")
     .update({revoked_at:now}).eq("id",data.receiver_invite_id).is("revoked_at",null);
    if(inviteRevokeError)return out({error:"RECEIVER_REVOKE_SYNC_FAILED"},503);
   }
   return out({ok:true,revoked:!!data});
  }
  if(action==="presence"){
   const {data,error}=await db.from("server_guest_push_devices").update({last_seen_at:now,updated_at:now})
    .eq("endpoint",endpoint).eq("receiver_secret_hash",secretHash).is("revoked_at",null)
    .or("expiration_at.is.null,expiration_at.gt."+now)
    .select("phone_e164").maybeSingle();
   if(error)return out({error:"RECEIVER_PRESENCE_FAILED"},503);
   if(data)return out({ok:true,active:true,phone_hint:phoneHint(data.phone_e164)});
   const {data:expired,error:expiredError}=await db.from("server_guest_push_devices")
    .select("phone_e164,expiration_at").eq("endpoint",endpoint)
    .eq("receiver_secret_hash",secretHash).is("revoked_at",null).maybeSingle();
   if(expiredError)return out({error:"RECEIVER_PRESENCE_FAILED"},503);
   return expired
    ?out({ok:true,active:false,needs_repair:true,expired:true,phone_hint:phoneHint(expired.phone_e164)})
    :out({ok:true,active:false});
  }
  const {data,error}=await db.from("server_guest_push_devices").select("phone_e164,expiration_at")
   .eq("endpoint",endpoint).eq("receiver_secret_hash",secretHash).is("revoked_at",null).maybeSingle();
  if(error)return out({error:"RECEIVER_STATUS_FAILED"},503);
  if(!data)return out({ok:true,active:false});
  const expired=!!data.expiration_at&&Date.parse(data.expiration_at)<=Date.now();
  return expired
   ?out({ok:true,active:false,needs_repair:true,expired:true,phone_hint:phoneHint(data.phone_e164)})
   :out({ok:true,active:true,phone_hint:phoneHint(data.phone_e164)});
 }

 // Native Receiver companion pairing and offline caller-roster support.
 if(action==="native_pair"){
  const deviceSecret=typeof b.device_secret==="string"?b.device_secret:"";
  if(!/^[0-9a-f]{64}$/i.test(deviceSecret))return out({error:"RECEIVER_DEVICE_CREDENTIALS_INVALID"},400);
  const {data:device,error}=await db.from("server_guest_push_devices").select("id")
   .eq("receiver_secret_hash",await sha(deviceSecret)).is("revoked_at",null).maybeSingle();
  if(error)return out({error:"RECEIVER_DEVICE_LOOKUP_FAILED"},503);
  if(!device)return out({error:"RECEIVER_DEVICE_NOT_ACTIVE"},401);
  const pairCode=Array.from(crypto.getRandomValues(new Uint8Array(16))).map(x=>x.toString(16).padStart(2,"0")).join("");
  const expiresAt=new Date(Date.now()+10*60*1000).toISOString();
  const {error:insertError}=await db.from("server_receiver_native_pair_codes").insert({
   receiver_device_id:device.id,pair_code_hash:await sha(pairCode),expires_at:expiresAt
  });
  if(insertError)return out({error:"RECEIVER_NATIVE_PAIR_CREATE_FAILED"},503);
  return out({ok:true,pair_code:pairCode,expires_at:expiresAt});
 }
 if(action==="native_claim"){
  const pairCode=typeof b.pair_code==="string"?b.pair_code:"";
  if(!/^[0-9a-f]{32}$/i.test(pairCode))return out({error:"RECEIVER_NATIVE_PAIR_INVALID"},400);
  const now=new Date().toISOString();
  const {data:pair,error:pairError}=await db.from("server_receiver_native_pair_codes")
   .select("id,receiver_device_id").eq("pair_code_hash",await sha(pairCode))
   .is("claimed_at",null).gt("expires_at",now).maybeSingle();
  if(pairError||!pair)return out({error:"RECEIVER_NATIVE_PAIR_EXPIRED_OR_USED"},401);
  const {data:claimed,error:claimError}=await db.from("server_receiver_native_pair_codes")
   .update({claimed_at:now}).eq("id",pair.id).is("claimed_at",null).gt("expires_at",now)
   .select("id").maybeSingle();
  if(claimError||!claimed)return out({error:"RECEIVER_NATIVE_PAIR_EXPIRED_OR_USED"},409);
  const nativeSecret=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("");
  const {error:saveError}=await db.from("server_receiver_native_devices").insert({
   receiver_device_id:pair.receiver_device_id,native_secret_hash:await sha(nativeSecret),
   last_seen_at:now,updated_at:now
  });
  if(saveError){
   await db.from("server_receiver_native_pair_codes").update({claimed_at:null})
    .eq("id",pair.id).eq("claimed_at",now);
   return out({error:"RECEIVER_NATIVE_DEVICE_SAVE_FAILED"},503);
  }
  return out({ok:true,native_secret:nativeSecret});
 }
 if(action==="native_roster"){
  const nativeSecret=typeof b.native_secret==="string"?b.native_secret:"";
  if(!/^[0-9a-f]{64}$/i.test(nativeSecret))return out({error:"RECEIVER_NATIVE_CREDENTIALS_INVALID"},400);
  const nativeHash=await sha(nativeSecret),now=new Date().toISOString();
  const {data:nativeDevice,error:nativeError}=await db.from("server_receiver_native_devices")
   .select("id,receiver_device_id").eq("native_secret_hash",nativeHash).is("revoked_at",null).maybeSingle();
  if(nativeError)return out({error:"RECEIVER_NATIVE_LOOKUP_FAILED"},503);
  if(!nativeDevice)return out({error:"RECEIVER_NATIVE_NOT_ACTIVE"},401);
  const {data:parent,error:parentError}=await db.from("server_guest_push_devices")
   .select("id").eq("id",nativeDevice.receiver_device_id).is("revoked_at",null).maybeSingle();
  if(parentError)return out({error:"RECEIVER_DEVICE_LOOKUP_FAILED"},503);
  if(!parent)return out({error:"RECEIVER_NATIVE_NOT_ACTIVE"},401);
  const {error:touchError}=await db.from("server_receiver_native_devices")
   .update({last_seen_at:now,updated_at:now}).eq("id",nativeDevice.id).is("revoked_at",null);
  if(touchError)return out({error:"RECEIVER_NATIVE_TOUCH_FAILED"},503);
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(nativeSecret),
   {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const callers:any[]=[];
  for(let offset=0;offset<10000;offset+=1000){
   const {data:rows,error}=await db.from("server_profiles")
    .select("server_id,display_name,phone_e164")
    .not("phone_e164","is",null).not("phone_verified_at","is",null)
    .eq("allow_number_based_server_calls",true).order("user_id",{ascending:true})
    .range(offset,offset+999);
   if(error)return out({error:"RECEIVER_NATIVE_ROSTER_FAILED"},503);
   for(const row of rows||[]){
    const phone=typeof row.phone_e164==="string"?row.phone_e164.trim():"";
    if(!/^\+[1-9][0-9]{7,14}$/.test(phone))continue;
    const signature=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(phone)));
    const callerHash=Array.from(signature).map(x=>x.toString(16).padStart(2,"0")).join("");
    callers.push({caller_hash:callerHash,server_id:row.server_id||"",display_name:row.display_name||"Server user"});
   }
   if((rows||[]).length<1000)break;
  }
  return out({ok:true,roster_version:now,caller_count:callers.length,callers});
 }
 if(action==="native_revoke"){
  const nativeSecret=typeof b.native_secret==="string"?b.native_secret:"";
  if(!/^[0-9a-f]{64}$/i.test(nativeSecret))return out({error:"RECEIVER_NATIVE_CREDENTIALS_INVALID"},400);
  const now=new Date().toISOString();
  const {data,error}=await db.from("server_receiver_native_devices")
   .update({revoked_at:now,updated_at:now}).eq("native_secret_hash",await sha(nativeSecret))
   .is("revoked_at",null).select("id").maybeSingle();
  if(error)return out({error:"RECEIVER_NATIVE_REVOKE_FAILED"},503);
  return out({ok:true,revoked:!!data});
 }

 const token=typeof b.token==="string"?b.token.trim():"";
 if(!/^[0-9a-f]{64}$/i.test(token))return out({error:"RECEIVER_INVITE_INVALID"},401);
 const {data:invite,error:inviteError}=await db.from("server_receiver_invites")
  .select("id,phone_e164,caller_label,expires_at,claimed_at,claimed_endpoint_hash,revoked_at")
  .eq("token_hash",await sha(token)).is("revoked_at",null).maybeSingle();
 if(inviteError||!invite||(invite.expires_at&&Date.parse(invite.expires_at)<=Date.now()))
  return out({error:"RECEIVER_INVITE_INVALID_OR_REVOKED"},401);
 if(action==="inspect")return out({ok:true,phone_hint:phoneHint(invite.phone_e164),invited_by:invite.caller_label,
  expires_at:invite.expires_at,already_claimed:!!invite.claimed_at});
 if(action==="push_config"){
  if(invite.claimed_at)return out({error:"RECEIVER_INVITE_ALREADY_USED"},409);
  const {data:keys,error}=await db.from("server_guest_push_config").select("public_key").eq("id",1).maybeSingle();
  if(error||!keys?.public_key)return out({error:"RECEIVER_PUSH_CONFIGURATION_UNAVAILABLE"},503);
  return out({ok:true,vapid_public_key:keys.public_key});
 }
 if(action!=="claim")return out({error:"ACTION_NOT_SUPPORTED"},400);
 if(b.consent!==true)return out({error:"RECEIVER_CONSENT_REQUIRED"},400);
 const subscription=b.subscription,endpoint=subscription?.endpoint,p256dh=subscription?.keys?.p256dh,auth=subscription?.keys?.auth;
 const deviceSecret=typeof b.device_secret==="string"?b.device_secret:"";
 if(!validPushEndpoint(endpoint)||typeof p256dh!=="string"||!/^[A-Za-z0-9_-]{80,160}$/.test(p256dh)||
    typeof auth!=="string"||!/^[A-Za-z0-9_-]{16,80}$/.test(auth)||!/^[0-9a-f]{64}$/i.test(deviceSecret))
  return out({error:"RECEIVER_SUBSCRIPTION_INVALID"},400);
 const now=new Date().toISOString(),endpointHash=await sha(endpoint),secretHash=await sha(deviceSecret);
 const {data:bound,error:boundError}=await db.from("server_guest_push_devices")
  .select("phone_e164,receiver_secret_hash").eq("endpoint",endpoint).is("revoked_at",null).maybeSingle();
 if(boundError)return out({error:"RECEIVER_DEVICE_LOOKUP_FAILED"},503);
 if(bound&&bound.phone_e164!==invite.phone_e164)
  return out({error:"RECEIVER_DEVICE_ALREADY_BOUND",message:"This browser is already connected to Server for a different phone number. Turn off its existing receiver first, or use another browser."},409);
 if(invite.claimed_at){
  if(invite.claimed_endpoint_hash!==endpointHash)return out({error:"RECEIVER_INVITE_ALREADY_USED"},409);
  const {data:existing,error}=await db.from("server_guest_push_devices").select("id")
   .eq("endpoint",endpoint).eq("receiver_secret_hash",secretHash).is("revoked_at",null).maybeSingle();
  if(error)return out({error:"RECEIVER_LOOKUP_FAILED"},503);
  if(!existing)return out({error:"RECEIVER_INVITE_ALREADY_USED"},409);
  await db.from("server_guest_push_devices").update({last_seen_at:now,updated_at:now}).eq("id",existing.id);
  return out({ok:true,registered:true,already_registered:true,phone_hint:phoneHint(invite.phone_e164)});
 }
 // Conditional claim ensures one setup link cannot enrol two different devices.
 const {data:claimed,error:claimError}=await db.from("server_receiver_invites").update({
  claimed_at:now,claimed_endpoint_hash:endpointHash
 }).eq("id",invite.id).is("claimed_at",null).is("revoked_at",null)
  .or("expires_at.is.null,expires_at.gt."+now).select("id").maybeSingle();
 if(claimError)return out({error:"RECEIVER_CLAIM_FAILED"},503);
 if(!claimed)return out({error:"RECEIVER_INVITE_ALREADY_USED"},409);
 const rollbackClaim=async()=>{
  await db.from("server_receiver_invites").update({claimed_at:null,claimed_endpoint_hash:null})
   .eq("id",invite.id).eq("claimed_endpoint_hash",endpointHash).eq("claimed_at",now);
 };
 const expiry=Number(subscription.expirationTime);
 const expirationAt=Number.isFinite(expiry)&&expiry>0?new Date(expiry).toISOString():null;
 // Insert without overwriting an existing endpoint. This also protects against
 // two different number invitations being claimed on the same browser at once.
 const {error:insertError}=await db.from("server_guest_push_devices").upsert({
  phone_e164:invite.phone_e164,endpoint,p256dh,auth,expiration_at:expirationAt,
  last_seen_at:now,updated_at:now,revoked_at:null
 },{onConflict:"endpoint",ignoreDuplicates:true});
 if(insertError){await rollbackClaim();return out({error:"RECEIVER_SUBSCRIPTION_SAVE_FAILED"},503);}
 const {data:device,error:deviceError}=await db.from("server_guest_push_devices")
  .select("id,phone_e164").eq("endpoint",endpoint).maybeSingle();
 if(deviceError||!device){await rollbackClaim();return out({error:"RECEIVER_SUBSCRIPTION_LOOKUP_FAILED"},503);}
 if(device.phone_e164!==invite.phone_e164){
  await rollbackClaim();
  return out({error:"RECEIVER_DEVICE_ALREADY_BOUND",message:"This browser is already connected to Server for a different phone number. Turn off its existing receiver first, or use another browser."},409);
 }
 const {error:saveError}=await db.from("server_guest_push_devices").update({
  p256dh,auth,expiration_at:expirationAt,last_seen_at:now,updated_at:now,revoked_at:null,
  receiver_secret_hash:secretHash,receiver_invite_id:invite.id
 }).eq("id",device.id).eq("phone_e164",invite.phone_e164);
 if(saveError){await rollbackClaim();return out({error:"RECEIVER_SUBSCRIPTION_SAVE_FAILED"},503);}
 return out({ok:true,registered:true,phone_hint:phoneHint(invite.phone_e164)});
});
