import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const cors={"access-control-allow-origin":"*","access-control-allow-headers":"authorization,apikey,content-type,webhook-id,webhook-signature,webhook-timestamp","access-control-allow-methods":"POST,OPTIONS","content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const out=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:cors});
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,"0")).join("");
function parseSecrets(s:string){return s.split("|").map(x=>x.trim()).filter(Boolean).map(x=>x.replace(/^v\d+,whsec_/,""))}
async function verify(body:string,headers:Record<string,string>,raw:string){for(const secret of parseSecrets(raw)){try{const v=new Webhook(secret).verify(body,headers) as unknown;if(v&&typeof v==="object"&&!Array.isArray(v))return v as Record<string,unknown>}catch{}}return null}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return out({error:"METHOD_NOT_ALLOWED"},405);
 const hookSecret=Deno.env.get("SEND_SMS_HOOK_SECRET")||"";if(!hookSecret)return out({error:"SMS_HOOK_NOT_CONFIGURED"},503);
 const body=await req.text();if(body.length>32000)return out({error:"PAYLOAD_TOO_LARGE"},413);
 const headers:Record<string,string>={};req.headers.forEach((v,k)=>headers[k]=v);
 const eventId=req.headers.get("webhook-id");
 if(!eventId||!req.headers.get("webhook-signature")||!req.headers.get("webhook-timestamp"))return out({error:"INVALID_HOOK_SIGNATURE"},401);
 const event=await verify(body,headers,hookSecret);if(!event)return out({error:"INVALID_HOOK_SIGNATURE"},401);
 const user=event.user as Record<string,unknown>|undefined,sms=event.sms as Record<string,unknown>|undefined;
 const to=typeof user?.phone==="string"?user.phone.trim():"",otp=typeof sms?.otp==="string"?sms.otp.trim():"";
 if(!/^\+[1-9][0-9]{7,14}$/.test(to)||!/^\d{4,8}$/.test(otp))return out({error:"INVALID_AUTH_SMS_EVENT"},400);
 const url=Deno.env.get("SUPABASE_URL")||"",key=(()=>{const raw=Deno.env.get("SUPABASE_SECRET_KEYS");if(raw){try{const parsed=JSON.parse(raw);if(parsed&&typeof parsed==="object")return parsed.default||Object.values(parsed)[0]||"";}catch{}}return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SUPABASE_SECRET_KEY")||"";})();if(!url||!key)return out({error:"SUPABASE_SERVER_CONFIG_MISSING"},500);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:existing}=await db.from("server_sms_jobs").select("id").eq("source_event_id",eventId).maybeSingle();
 if(existing)return new Response("{}",{status:200,headers:cors});
 const {data:gateway,error:ge}=await db.from("server_gateway_devices").select("id").eq("enabled",true).gte("last_seen_at",new Date(Date.now()-90000).toISOString()).limit(1).maybeSingle();
 if(ge||!gateway)return out({error:"SMS_GATEWAY_OFFLINE"},503);
 const limitKey=await sha("sms-hook:"+to);
 const {data:allowed,error:le}=await db.rpc("server_rate_limit_allow",{p_scope:"auth_sms_phone",p_key_hash:limitKey,p_window_seconds:900,p_max_hits:5});
 if(le||allowed!==true)return out({error:"SMS_RATE_LIMITED"},429);
 const message="Your Server verification code is "+otp+". Do not share this code with anyone.";
 const {error:ie}=await db.from("server_sms_jobs").insert({category:"auth_otp",recipient_e164:to,body:message,auth_user_id:typeof user?.id==="string"?user.id:null,source_event_id:eventId,status:"queued"});
 if(ie&&ie.code!=="23505")return out({error:"SMS_QUEUE_UNAVAILABLE"},503);
 return new Response("{}",{status:200,headers:cors});
});