import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const cors={"access-control-allow-origin":"*","access-control-allow-headers":"authorization,apikey,content-type","access-control-allow-methods":"POST,OPTIONS","content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const out=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:cors});
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const kinds=new Set(["offer","answer","ice","hangup","state"]);
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return out({error:"METHOD_NOT_ALLOWED"},405);
 let b:Record<string,unknown>;try{b=await req.json();if(!b||Array.isArray(b)||typeof b!=="object")throw 0;}catch{return out({error:"INVALID_JSON"},400);}
 const url=Deno.env.get("SUPABASE_URL")||"",key=(()=>{const raw=Deno.env.get("SUPABASE_SECRET_KEYS");if(raw){try{const parsed=JSON.parse(raw);if(parsed&&typeof parsed==="object")return parsed.default||Object.values(parsed)[0]||"";}catch{}}return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SUPABASE_SECRET_KEY")||"";})();if(!url||!key)return out({error:"SUPABASE_SERVER_CONFIG_MISSING"},500);
 const token=typeof b.token==="string"?b.token:"";if(token.length<48||token.length>256)return out({error:"GUEST_TOKEN_INVALID"},401);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:invite,error:invErr}=await db.from("server_guest_invites").select("id,call_id,phone_e164,expires_at,joined_at,revoked_at").eq("token_hash",await sha(token)).is("revoked_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();
 if(invErr||!invite)return out({error:"GUEST_INVITE_EXPIRED_OR_INVALID"},401);
 const action=typeof b.action==="string"?b.action:"";
 if(action==="join"){
  const now=new Date().toISOString();await db.from("server_guest_invites").update({joined_at:invite.joined_at||now}).eq("id",invite.id);
  await db.from("server_calls").update({state:"connecting",updated_at:now}).eq("id",invite.call_id).in("state",["ringing","connecting"]);
  const {data:call}=await db.from("server_calls").select("id,state,route,created_at,updated_at").eq("id",invite.call_id).maybeSingle();
  return out({ok:true,invite_id:invite.id,call,ice_servers:[{urls:"stun:stun.l.google.com:19302"}],media_requirement:"HTTPS, internet access, and microphone permission required. This is not a cellular/PSTN call."});
 }
 if(action==="poll"){
  const after=Number.isSafeInteger(b.after_seq)&&Number(b.after_seq)>=0?Number(b.after_seq):0;
  const {data:signals,error}=await db.from("server_call_signals").select("seq,from_user_id,kind,payload,created_at").eq("call_id",invite.call_id).is("from_guest_invite_id",null).gt("seq",after).order("seq",{ascending:true}).limit(100);
  if(error)return out({error:"SIGNAL_POLL_FAILED"},503);
  const {data:call}=await db.from("server_calls").select("id,state,route,updated_at").eq("id",invite.call_id).maybeSingle();
  return out({signals:signals||[],call,next_after_seq:signals?.length?signals[signals.length-1].seq:after});
 }
 if(action==="signal"){
  const callId=typeof b.call_id==="string"?b.call_id:invite.call_id,kind=typeof b.kind==="string"?b.kind:"";
  const payload=b.payload&&typeof b.payload==="object"&&!Array.isArray(b.payload)?b.payload:{};
  if(callId!==invite.call_id||!kinds.has(kind)||JSON.stringify(payload).length>18000)return out({error:"INVALID_SIGNAL"},400);
  const {data:signal,error}=await db.from("server_call_signals").insert({call_id:invite.call_id,from_guest_invite_id:invite.id,kind,payload}).select("seq,created_at").single();
  if(error||!signal)return out({error:"SIGNAL_SAVE_FAILED"},503);
  const now=new Date().toISOString();
  if(kind==="hangup")await db.from("server_calls").update({state:"ended",ended_at:now,updated_at:now}).eq("id",invite.call_id);
  else if(kind==="answer"||kind==="offer")await db.from("server_calls").update({state:"connecting",updated_at:now}).eq("id",invite.call_id).in("state",["ringing","connecting"]);
  return out({ok:true,seq:signal.seq,created_at:signal.created_at});
 }
 if(action==="leave"){
  const now=new Date().toISOString();await db.from("server_call_signals").insert({call_id:invite.call_id,from_guest_invite_id:invite.id,kind:"hangup",payload:{}});
  await db.from("server_calls").update({state:"ended",ended_at:now,updated_at:now}).eq("id",invite.call_id);return out({ok:true});
 }
 return out({error:"UNKNOWN_ACTION"},400);
});