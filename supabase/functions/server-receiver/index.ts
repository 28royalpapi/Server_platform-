import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const cors={"access-control-allow-origin":"*","access-control-allow-headers":"authorization,apikey,content-type","access-control-allow-methods":"POST,OPTIONS","content-type":"application/json; charset=utf-8","cache-control":"no-store"};
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
 if(bound?.receiver_secret_hash&&bound.phone_e164!==invite.phone_e164)
  return out({error:"RECEIVER_DEVICE_ALREADY_BOUND",message:"This browser is already connected to Server for a different phone number."},409);
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
 const expiry=Number(subscription.expirationTime);
 const expirationAt=Number.isFinite(expiry)&&expiry>0?new Date(expiry).toISOString():null;
 const {error:saveError}=await db.from("server_guest_push_devices").upsert({
  phone_e164:invite.phone_e164,endpoint,p256dh,auth,expiration_at:expirationAt,
  last_seen_at:now,updated_at:now,revoked_at:null,receiver_secret_hash:secretHash,receiver_invite_id:invite.id
 },{onConflict:"endpoint"});
 if(saveError){
  await db.from("server_receiver_invites").update({claimed_at:null,claimed_endpoint_hash:null})
   .eq("id",invite.id).eq("claimed_endpoint_hash",endpointHash).eq("claimed_at",now);
  return out({error:"RECEIVER_SUBSCRIPTION_SAVE_FAILED"},503);
 }
 return out({ok:true,registered:true,phone_hint:phoneHint(invite.phone_e164)});
});
