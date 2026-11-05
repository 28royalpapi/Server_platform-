import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const cors={"access-control-allow-origin":"*","access-control-allow-headers":"authorization,apikey,content-type","access-control-allow-methods":"POST,GET,OPTIONS","content-type":"application/json","cache-control":"no-store"};
const out=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:cors});
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
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,"0")).join("");
function client(){const url=Deno.env.get("SUPABASE_URL")||"";let key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SUPABASE_SECRET_KEY")||"";if(!key){try{const k=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");key=k.default||Object.values(k)[0]||"";}catch{}}if(!url||!key)throw new Error("SERVER_NOT_CONFIGURED");return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});}
Deno.serve(async(req:Request)=>{if(req.method==="OPTIONS")return new Response("ok",{status:204,headers:cors});if(!["POST","GET"].includes(req.method))return out({error:"METHOD_NOT_ALLOWED"},405);
let b:any={},u=new URL(req.url);if(req.method==="POST"){try{b=await req.json();if(!b||typeof b!=="object"||Array.isArray(b))throw 0;}catch{return out({error:"INVALID_JSON"},400)}}
const raw=(req.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]||b.token||u.searchParams.get("token")||"";
if(typeof raw!=="string"||raw.length<48||raw.length>256)return out({error:"INVALID_INVITE"},401);
let db:any;try{db=client()}catch{return out({error:"SERVER_NOT_CONFIGURED"},503)}
const {data:invite,error:ie}=await db.from("server_guest_invites").select("id,call_id,phone_e164,expires_at,joined_at,revoked_at").eq("token_hash",await sha(raw)).is("revoked_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();
if(ie||!invite)return out({error:"GUEST_INVITE_EXPIRED_OR_INVALID"},401);
const action=String(b.action||"");
async function loadGuestCall(){
 const {data:call,error}=await db.from("server_calls")
  .select("id,state,route,caller_user_id,created_at,updated_at,expires_at")
  .eq("id",invite.call_id).maybeSingle();
 if(error||!call)return {call:null,error};
 if(["ringing","connecting"].includes(call.state)&&call.expires_at&&Date.parse(call.expires_at)<=Date.now()){
  const now=new Date().toISOString();
  await db.from("server_calls").update({state:"missed",ended_at:now,updated_at:now})
   .eq("id",invite.call_id).in("state",["ringing","connecting"]);
  return {call:{...call,state:"missed",updated_at:now},error:null};
 }
 return {call,error:null};
}
if(req.method==="GET"||action==="inspect"){
 const {call,error:callError}=await loadGuestCall();
 if(callError||!call)return out({error:"CALL_NOT_FOUND"},404);
 const {data:caller}=await db.from("server_profiles").select("server_id").eq("user_id",call.caller_user_id).maybeSingle();
 return out({call_id:invite.call_id,expires_at:invite.expires_at,joined:!!invite.joined_at,caller_server_id:caller?.server_id||"A Server user",call:{id:call.id,state:call.state,route:call.route,created_at:call.created_at,updated_at:call.updated_at}});
}
if(action==="join"){
 const {call,error:callError}=await loadGuestCall();
 if(callError||!call)return out({error:"CALL_NOT_FOUND"},404);
 if(!["ringing","connecting"].includes(call.state))return out({error:"CALL_NOT_ANSWERABLE"},409);
 const now=new Date().toISOString();
 const {error}=await db.from("server_guest_invites").update({joined_at:invite.joined_at||now}).eq("id",invite.id);
 if(error)return out({error:"INVITE_JOIN_FAILED"},503);
 await db.from("server_calls").update({state:"connecting",updated_at:now}).eq("id",invite.call_id).in("state",["ringing","connecting"]);
 const {call:updatedCall,error:ce}=await loadGuestCall();
 if(ce||!updatedCall)return out({error:"CALL_NOT_FOUND"},404);
 if(!["ringing","connecting"].includes(updatedCall.state))return out({error:"CALL_NOT_ANSWERABLE"},409);
 return out({ok:true,invite_id:invite.id,call:updatedCall,ice_servers:await iceServersForCall(invite.id,Math.max(300,Math.ceil((Date.parse(updatedCall.expires_at)-Date.now())/1000))),media_requirement:"HTTPS, internet access and microphone permission are required. This is an internet call, not a cellular/PSTN call."});
}
if(action==="poll"){
 const after=Math.max(0,Number.isSafeInteger(b.after_seq)?Number(b.after_seq):Number(b.after)||0);
 const {data:signals,error}=await db.from("server_call_signals").select("seq,from_user_id,kind,payload,created_at").eq("call_id",invite.call_id).is("from_guest_invite_id",null).gt("seq",after).order("seq",{ascending:true}).limit(100);
 if(error)return out({error:"SIGNAL_POLL_FAILED"},503);
 const {call,error:ce}=await loadGuestCall();
 if(ce||!call)return out({error:"CALL_NOT_FOUND"},404);
 const rows=signals||[];
 return out({signals:rows,call,next_after_seq:rows.length?rows[rows.length-1].seq:after});
}
if(action==="signal"){
 if(!invite.joined_at)return out({error:"JOIN_REQUIRED"},403);
 const callId=typeof b.call_id==="string"?b.call_id:invite.call_id;
 const kind=String(b.kind||"");
 const payload=b.payload&&typeof b.payload==="object"&&!Array.isArray(b.payload)?b.payload:{};
 if(callId!==invite.call_id||!["offer","answer","ice","hangup","state"].includes(kind))return out({error:"INVALID_SIGNAL"},400);
 if(JSON.stringify(payload).length>18000)return out({error:"PAYLOAD_TOO_LARGE"},413);
 const {data:signal,error}=await db.from("server_call_signals").insert({call_id:invite.call_id,from_guest_invite_id:invite.id,kind,payload}).select("seq,created_at").single();
 if(error||!signal)return out({error:"SIGNAL_SAVE_FAILED"},503);
 const now=new Date().toISOString();
 if(kind==="hangup")await db.from("server_calls").update({state:"ended",ended_at:now,updated_at:now}).eq("id",invite.call_id);
 else if(kind==="offer"||kind==="answer")await db.from("server_calls").update({state:"connecting",updated_at:now}).eq("id",invite.call_id).in("state",["ringing","connecting"]);
 else if(kind==="state"&&payload.state==="active")await db.from("server_calls").update({state:"active",updated_at:now}).eq("id",invite.call_id).in("state",["ringing","connecting"]);
 return out({ok:true,seq:signal.seq,created_at:signal.created_at});
}
if(action==="leave"){
 const now=new Date().toISOString();
 await db.from("server_call_signals").insert({call_id:invite.call_id,from_guest_invite_id:invite.id,kind:"hangup",payload:{}});
 await db.from("server_calls").update({state:"ended",ended_at:now,updated_at:now}).eq("id",invite.call_id);
 return out({ok:true});
}
return out({error:"UNKNOWN_ACTION"},400);
});