import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const cors={"access-control-allow-origin":"*","access-control-allow-headers":"authorization,apikey,content-type","access-control-allow-methods":"POST,OPTIONS","content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const out=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:cors});
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const phone=(v:unknown)=>typeof v==="string"&&/^\+[1-9][0-9]{7,14}$/.test(v.trim())?v.trim():null;
const newToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("");
const expiry=()=>new Date(Date.now()+30*24*60*60*1000).toISOString();
function client(){
 const url=Deno.env.get("SUPABASE_URL")||"";
 let key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SUPABASE_SECRET_KEY")||"";
 if(!key){try{const v=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");key=v.default||Object.values(v)[0]||"";}catch{}}
 if(!url||!key)throw new Error("SUPABASE_SERVER_CONFIG_MISSING");
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
function ipHash(req:Request){const ip=(req.headers.get("cf-connecting-ip")||req.headers.get("x-real-ip")||(req.headers.get("x-forwarded-for")||"unknown").split(",")[0].trim()||"unknown").slice(0,160);return sha("server-auth-ip:"+ip);}
async function bearer(req:Request,db:any){
 const token=(req.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]||"";
 if(!/^[0-9a-f]{64}$/.test(token))return null;
 const hash=await sha(token);
 const {data,error}=await db.from("server_sessions").select("id,user_id,expires_at").eq("token_hash",hash).is("revoked_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();
 if(error||!data)return null;
 return {token,hash,...data};
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return out({error:"METHOD_NOT_ALLOWED"},405);
 let b:Record<string,unknown>;try{b=await req.json();if(!b||Array.isArray(b)||typeof b!=="object")throw 0;}catch{return out({error:"INVALID_JSON"},400);}
 let db:any;try{db=client();}catch{return out({error:"SERVER_AUTH_NOT_CONFIGURED"},500);}
 const action=typeof b.action==="string"?b.action:"";
 try{

  if(action==="register_device"){
   const installationId=typeof b.installation_id==="string"?b.installation_id.trim().toLowerCase():"";
   const deviceSecret=typeof b.device_secret==="string"?b.device_secret.trim().toLowerCase():"";
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(installationId)||!/^[0-9a-f]{64}$/.test(deviceSecret)){
    return out({error:"INVALID_DEVICE_CREDENTIALS"},400);
   }
   const slot=Number.isInteger(b.selected_sim_slot)&&Number(b.selected_sim_slot)>=0?Number(b.selected_sim_slot):null;
   const carrier=typeof b.selected_sim_carrier==="string"?b.selected_sim_carrier.trim().slice(0,80)||null:null;
   if(b.accepted_terms!==true||b.terms_version!=="server-terms-1.0"||b.privacy_version!=="server-privacy-1.0"){
    return out({error:"LEGAL_ACCEPTANCE_REQUIRED"},400);
   }
   const secretHash=await sha(deviceSecret);
   let identity:any=null;
   const {data:existing,error:existingError}=await db.from("server_device_identities").select("installation_id,secret_hash,user_id,revoked_at").eq("installation_id",installationId).maybeSingle();
   if(existingError)return out({error:"DEVICE_LOOKUP_FAILED"},503);
   if(existing){
    if(existing.revoked_at||existing.secret_hash!==secretHash)return out({error:"DEVICE_CREDENTIALS_REJECTED"},401);
    identity=existing;
    const {error:updateError}=await db.from("server_device_identities").update({
      last_seen_at:new Date().toISOString(),
      selected_sim_slot:slot,
      selected_sim_carrier:carrier
    }).eq("installation_id",installationId);
    if(updateError)return out({error:"DEVICE_UPDATE_FAILED"},503);
   }else{
    const {data:limitData,error:limitError}=await db.rpc("server_rate_limit_allow",{
      p_scope:"device-bootstrap",
      p_key_hash:await ipHash(req),
      p_window_seconds:3600,
      p_max_hits:20
    });
    if(limitError)return out({error:"DEVICE_REGISTRATION_UNAVAILABLE"},503);
    if(limitData!==true)return out({error:"DEVICE_REGISTRATION_RATE_LIMITED"},429);
    const {data:profile,error:profileError}=await db.from("server_profiles")
      .insert({phone_e164:null})
      .select("user_id,server_id,phone_e164,phone_verified_at")
      .single();
    if(profileError||!profile)return out({error:"DEVICE_PROFILE_CREATE_FAILED"},503);
    const {data:created,error:createError}=await db.from("server_device_identities").insert({
      installation_id:installationId,
      secret_hash:secretHash,
      user_id:profile.user_id,
      selected_sim_slot:slot,
      selected_sim_carrier:carrier
    }).select("installation_id,secret_hash,user_id,revoked_at").single();
    if(createError||!created){
      await db.from("server_profiles").delete().eq("user_id",profile.user_id);
      return out({error:"DEVICE_REGISTRATION_FAILED"},503);
    }
    identity=created;
   }
   const {data:profile,error:profileError}=await db.from("server_profiles")
    .select("user_id,server_id,phone_e164,phone_verified_at")
    .eq("user_id",identity.user_id).maybeSingle();
   if(profileError||!profile)return out({error:"DEVICE_PROFILE_LOOKUP_FAILED"},503);
   const {error:legalError}=await db.from("server_profiles").update({
    accepted_terms_version:"server-terms-1.0",
    accepted_privacy_version:"server-privacy-1.0",
    accepted_legal_at:new Date().toISOString(),
    updated_at:new Date().toISOString()
   }).eq("user_id",profile.user_id);
   if(legalError)return out({error:"LEGAL_ACCEPTANCE_SAVE_FAILED"},503);
   const access=newToken(),validUntil=expiry();
   const {error:sessionError}=await db.from("server_sessions").insert({
    user_id:profile.user_id,token_hash:await sha(access),expires_at:validUntil,
    user_agent:(req.headers.get("user-agent")||"").slice(0,300)||null
   });
   if(sessionError)return out({error:"SESSION_CREATE_FAILED"},503);
   return out({
    ok:true,access_token:access,token_type:"Bearer",expires_at:validUntil,
    user:{id:profile.user_id,server_id:profile.server_id,phone:profile.phone_e164,phone_verified_at:profile.phone_verified_at}
   });
  }
  if(action==="request_otp"){
   const to=phone(b.phone);if(!to)return out({error:"INVALID_PHONE_FORMAT"},400);
   const rawCode=crypto.getRandomValues(new Uint32Array(1))[0]%1000000;
   const code=String(rawCode).padStart(6,"0");
   const {data,error}=await db.rpc("server_issue_otp",{p_phone:to,p_code:code,p_ip_hash:await ipHash(req)});
   if(error)return out({error:"OTP_QUEUE_FAILED"},503);
   const result=data as Record<string,unknown>;
   if(result?.status==="GATEWAY_OFFLINE")return out({error:"SMS_GATEWAY_OFFLINE"},503);
   if(result?.status==="RATE_LIMITED")return out({error:"OTP_RATE_LIMITED"},429);
   if(result?.status!=="QUEUED")return out({error:"OTP_REQUEST_REJECTED"},400);
   return out({ok:true,phone:to,expires_at:result.expires_at,delivery:"queued_to_paired_android_sim"});
  }
  if(action==="verify_otp"){
   const to=phone(b.phone),code=typeof b.code==="string"?b.code.trim():"";
   if(!to||!/^[0-9]{6}$/.test(code))return out({error:"INVALID_CODE_FORMAT"},400);
   const {data,error}=await db.rpc("server_verify_otp",{p_phone:to,p_code:code,p_ip_hash:await ipHash(req)});
   if(error)return out({error:"OTP_VERIFY_UNAVAILABLE"},503);
   const result=data as Record<string,unknown>;
   if(result?.status==="RATE_LIMITED")return out({error:"OTP_VERIFY_RATE_LIMITED"},429);
   if(result?.status!=="VERIFIED")return out({error:"INVALID_OR_EXPIRED_CODE"},400);
   let profile:any=null;
   const {data:existing,error:findError}=await db.from("server_profiles").select("user_id,phone_e164,phone_verified_at").eq("phone_e164",to).maybeSingle();
   if(findError)return out({error:"PROFILE_LOOKUP_FAILED"},503);
   if(existing){
    const updated=await db.from("server_profiles").update({phone_verified_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("user_id",existing.user_id).select("user_id,phone_e164,phone_verified_at").single();
    if(updated.error)return out({error:"PROFILE_SAVE_FAILED"},503);profile=updated.data;
   }else{
    const created=await db.from("server_profiles").insert({phone_e164:to,phone_verified_at:new Date().toISOString()}).select("user_id,phone_e164,phone_verified_at").single();
    if(created.error){
     if(created.error.code!=="23505")return out({error:"PROFILE_CREATE_FAILED"},503);
     const retry=await db.from("server_profiles").select("user_id,phone_e164,phone_verified_at").eq("phone_e164",to).single();
     if(retry.error)return out({error:"PROFILE_CREATE_FAILED"},503);profile=retry.data;
    }else profile=created.data;
   }
   const access=newToken(),validUntil=expiry();
   const {error:sessionError}=await db.from("server_sessions").insert({user_id:profile.user_id,token_hash:await sha(access),expires_at:validUntil,user_agent:(req.headers.get("user-agent")||"").slice(0,300)||null});
   if(sessionError)return out({error:"SESSION_CREATE_FAILED"},503);
   return out({ok:true,access_token:access,token_type:"Bearer",expires_at:validUntil,user:{id:profile.user_id,phone:profile.phone_e164,phone_verified_at:profile.phone_verified_at}});
  }
  const session=await bearer(req,db);if(!session)return out({error:"SESSION_REQUIRED"},401);
  if(action==="link_phone"){
   const to=phone(b.phone),code=typeof b.code==="string"?b.code.trim():"";
   if(!to)return out({error:"INVALID_PHONE_FORMAT"},400);
   if(!/^[0-9]{6}$/.test(code))return out({error:"INVALID_CODE_FORMAT"},400);

   const {data:profile,error:profileError}=await db.from("server_profiles")
    .select("user_id,server_id,phone_e164,phone_verified_at")
    .eq("user_id",session.user_id).maybeSingle();
   if(profileError||!profile)return out({error:"PROFILE_LOOKUP_FAILED"},503);
   if(profile.phone_e164===to&&profile.phone_verified_at){
    return out({ok:true,phone:to,phone_verified_at:profile.phone_verified_at,already_linked:true});
   }

   // A verified phone belongs to one Server identity. Check before consuming
   // the OTP; the UNIQUE(phone_e164) constraint closes concurrent-link races.
   const {data:owner,error:ownerError}=await db.from("server_profiles")
    .select("user_id").eq("phone_e164",to).maybeSingle();
   if(ownerError)return out({error:"PHONE_OWNERSHIP_LOOKUP_FAILED"},503);
   if(owner&&owner.user_id!==session.user_id)return out({error:"PHONE_ALREADY_LINKED"},409);

   const {data:verification,error:verifyError}=await db.rpc("server_verify_otp",{
    p_phone:to,p_code:code,p_ip_hash:await ipHash(req)
   });
   if(verifyError)return out({error:"OTP_VERIFY_UNAVAILABLE"},503);
   const verdict=verification as Record<string,unknown>;
   if(verdict?.status==="RATE_LIMITED")return out({error:"OTP_VERIFY_RATE_LIMITED"},429);
   if(verdict?.status!=="VERIFIED")return out({error:"INVALID_OR_EXPIRED_CODE"},400);

   const verifiedAt=new Date().toISOString();
   const {data:updated,error:updateError}=await db.from("server_profiles").update({
    phone_e164:to,phone_verified_at:verifiedAt,updated_at:verifiedAt
   }).eq("user_id",session.user_id).select("user_id,server_id,phone_e164,phone_verified_at").single();
   if(updateError){
    if(updateError.code==="23505")return out({error:"PHONE_ALREADY_LINKED"},409);
    return out({error:"PHONE_LINK_FAILED"},503);
   }
   return out({ok:true,phone:updated.phone_e164,phone_verified_at:updated.phone_verified_at,server_id:updated.server_id});
  }
  if(action==="refresh"){
   const validUntil=expiry();
   const {error}=await db.from("server_sessions").update({expires_at:validUntil,last_seen_at:new Date().toISOString()}).eq("id",session.id);
   if(error)return out({error:"SESSION_REFRESH_FAILED"},503);
   return out({ok:true,access_token:session.token,token_type:"Bearer",expires_at:validUntil});
  }
  if(action==="me"){
   const {data:profile,error}=await db.from("server_profiles").select("user_id,server_id,phone_e164,phone_verified_at,accepted_terms_version,accepted_privacy_version,accepted_legal_at,notifications_enabled,contacts_access_requested").eq("user_id",session.user_id).maybeSingle();
   if(error||!profile)return out({error:"PROFILE_LOOKUP_FAILED"},503);
   await db.from("server_sessions").update({last_seen_at:new Date().toISOString()}).eq("id",session.id);
   return out({ok:true,user:profile});
  }
  if(action==="logout"){
   const {error}=await db.from("server_sessions").update({revoked_at:new Date().toISOString()}).eq("id",session.id);
   if(error)return out({error:"SESSION_REVOKE_FAILED"},503);
   return out({ok:true});
  }
  return out({error:"UNKNOWN_ACTION"},400);
 }catch{return out({error:"SERVER_AUTH_INTERNAL_ERROR"},500);}
});