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
     Date.parse(row.expires_at)<=Date.now()?"expired":"pending";
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
   const expiresAt=new Date(Date.now()+7*24*60*60*1000).toISOString();
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
 // Per-device secret permits status, heartbeat and revocation. Only its hash is stored.
 if(["status","presence","revoke"].includes(action)){
  const endpoint=b.endpoint,secret=typeof b.device_secret==="string"?b.device_secret:"";
  if(!validPushEndpoint(endpoint)||!/^[0-9a-f]{64}$/i.test(secret))return out({error:"RECEIVER_DEVICE_CREDENTIALS_INVALID"},400);
  const secretHash=await sha(secret),now=new Date().toISOString();
  if(action==="revoke"){
   const {data,error}=await db.from("server_guest_push_devices").update({revoked_at:now,updated_at:now})
    .eq("endpoint",endpoint).eq("receiver_secret_hash",secretHash).is("revoked_at",null).select("id").maybeSingle();
   if(error)return out({error:"RECEIVER_REVOKE_FAILED"},503);
   return out({ok:true,revoked:!!data});
  }
  if(action==="presence"){
   const {data,error}=await db.from("server_guest_push_devices").update({last_seen_at:now,updated_at:now})
    .eq("endpoint",endpoint).eq("receiver_secret_hash",secretHash).is("revoked_at",null)
    .select("phone_e164").maybeSingle();
   if(error)return out({error:"RECEIVER_PRESENCE_FAILED"},503);
   return data?out({ok:true,active:true,phone_hint:phoneHint(data.phone_e164)}):out({ok:true,active:false});
  }
  const {data,error}=await db.from("server_guest_push_devices").select("phone_e164")
   .eq("endpoint",endpoint).eq("receiver_secret_hash",secretHash).is("revoked_at",null).maybeSingle();
  if(error)return out({error:"RECEIVER_STATUS_FAILED"},503);
  return data?out({ok:true,active:true,phone_hint:phoneHint(data.phone_e164)}):out({ok:true,active:false});
 }
 const token=typeof b.token==="string"?b.token.trim():"";
 if(!/^[0-9a-f]{64}$/i.test(token))return out({error:"RECEIVER_INVITE_INVALID"},401);
 const {data:invite,error:inviteError}=await db.from("server_receiver_invites")
  .select("id,phone_e164,caller_label,expires_at,claimed_at,claimed_endpoint_hash,revoked_at")
  .eq("token_hash",await sha(token)).is("revoked_at",null).maybeSingle();
 if(inviteError||!invite||Date.parse(invite.expires_at)<=Date.now())return out({error:"RECEIVER_INVITE_INVALID_OR_EXPIRED"},401);
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
 }).eq("id",invite.id).is("claimed_at",null).is("revoked_at",null).gt("expires_at",now).select("id").maybeSingle();
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
