import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const cors={"access-control-allow-origin":"*","access-control-allow-headers":"authorization,apikey,content-type","access-control-allow-methods":"POST,OPTIONS","content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const out=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:cors});
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const alphabet="23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function code(n=8){const bytes=crypto.getRandomValues(new Uint8Array(n));return Array.from(bytes,b=>alphabet[b%alphabet.length]).join("")}
function token(){return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("")}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return out({error:"METHOD_NOT_ALLOWED"},405);
 let b:Record<string,unknown>;try{b=await req.json();if(!b||Array.isArray(b)||typeof b!=="object")throw 0;}catch{return out({error:"INVALID_JSON"},400);}
 const url=Deno.env.get("SUPABASE_URL")||"",key=(()=>{const raw=Deno.env.get("SUPABASE_SECRET_KEYS");if(raw){try{const parsed=JSON.parse(raw);if(parsed&&typeof parsed==="object")return parsed.default||Object.values(parsed)[0]||"";}catch{}}return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SUPABASE_SECRET_KEY")||"";})();if(!url||!key)return out({error:"SUPABASE_SERVER_CONFIG_MISSING"},500);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});const action=typeof b.action==="string"?b.action:"";
 if(action==="create_pairing_code"){
  const jwt=(req.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];if(!jwt)return out({error:"AUTH_REQUIRED"},401);
  const {data:auth,error:ae}=await db.auth.getUser(jwt);if(ae||!auth.user)return out({error:"AUTH_REQUIRED"},401);
  const {data:allowed,error:le}=await db.rpc("server_rate_limit_allow",{p_scope:"gateway_pairing_code",p_key_hash:await sha(auth.user.id),p_window_seconds:3600,p_max_hits:5});
  if(le||allowed!==true)return out({error:"PAIRING_RATE_LIMITED"},429);
  const pairing=code(),expires=new Date(Date.now()+10*60*1000).toISOString();
  const {error}=await db.from("server_gateway_pairings").insert({code_hash:await sha(pairing),expires_at:expires});
  if(error)return out({error:"PAIRING_CODE_CREATE_FAILED"},503);
  return out({ok:true,pairing_code:pairing,expires_at:expires,instructions:"Enter this one-time code in the Android Server SIM Gateway app within 10 minutes. It is shown only once."});
 }
 if(action==="claim"){
  const pairingCode=typeof b.pairing_code==="string"?b.pairing_code.trim().toUpperCase():"";
  if(!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(pairingCode))return out({error:"PAIRING_CODE_INVALID"},400);
  const {data:pair,error:pe}=await db.from("server_gateway_pairings").select("id,expires_at,claimed_at").eq("code_hash",await sha(pairingCode)).is("claimed_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();
  if(pe||!pair)return out({error:"PAIRING_CODE_EXPIRED_OR_INVALID"},401);
  const {data:claimed,error:claimErr}=await db.from("server_gateway_pairings").update({claimed_at:new Date().toISOString()}).eq("id",pair.id).is("claimed_at",null).select("id").maybeSingle();
  if(claimErr||!claimed)return out({error:"PAIRING_CODE_ALREADY_USED"},409);
  const deviceToken=token(),label=(typeof b.device_label==="string"?b.device_label:"Server SIM Gateway").trim().slice(0,80)||"Server SIM Gateway";
  const {data:device,error}=await db.from("server_gateway_devices").insert({label,token_hash:await sha(deviceToken),enabled:true,last_seen_at:new Date().toISOString()}).select("id,label").single();
  if(error||!device)return out({error:"GATEWAY_REGISTER_FAILED"},503);
  return out({ok:true,gateway_token:deviceToken,device_id:device.id,device_label:device.label});
 }
 const bearer=(req.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]||"";
 if(bearer.length<48||bearer.length>256)return out({error:"GATEWAY_UNAUTHORIZED"},401);
 const hash=await sha(bearer);
 const {data:device,error:de}=await db.from("server_gateway_devices").select("id,enabled").eq("token_hash",hash).maybeSingle();
 if(de||!device||!device.enabled)return out({error:"GATEWAY_UNAUTHORIZED"},401);
 const now=new Date().toISOString();await db.from("server_gateway_devices").update({last_seen_at:now,updated_at:now}).eq("id",device.id);
 if(action==="poll"){
  const {data:jobs,error}=await db.rpc("server_claim_sms_jobs",{p_device_id:device.id,p_limit:3});
  if(error)return out({error:"SMS_QUEUE_POLL_FAILED"},503);
  return out({ok:true,jobs:jobs||[],server_time:now});
 }
 if(action==="complete"){
  const jobId=typeof b.job_id==="string"?b.job_id:"",status=typeof b.status==="string"?b.status:"";
  if(!jobId||!["sent","delivered","failed"].includes(status))return out({error:"INVALID_JOB_STATUS"},400);
  const permitted=status==="sent"?["leased"]:["leased","sent"];
  const update:Record<string,unknown>={status,updated_at:now,body:null,lease_until:null,error_code:status==="failed"?(typeof b.error_code==="string"?b.error_code.slice(0,64):"SMS_SEND_FAILED"):null};
  if(status==="sent")update.sent_at=now;if(status==="delivered")update.delivered_at=now;
  const {data:job,error}=await db.from("server_sms_jobs").update(update).eq("id",jobId).eq("gateway_device_id",device.id).in("status",permitted).select("id,status").maybeSingle();
  if(error||!job)return out({error:"JOB_NOT_OWNED_OR_ALREADY_FINISHED"},409);
  return out({ok:true,job_id:job.id,status:job.status});
 }
 if(action==="health")return out({ok:true,device_id:device.id,enabled:device.enabled,last_seen_at:now});
 return out({error:"UNKNOWN_ACTION"},400);
});