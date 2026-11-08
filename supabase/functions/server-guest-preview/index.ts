import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const headers = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY"
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c] as string));
const sha = async (value: string) => Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))
).map(x => x.toString(16).padStart(2,"0")).join("");

const FONT: Record<string, number[]> = {
  "A":[14,17,17,31,17,17,17],"B":[30,17,17,30,17,17,30],"C":[14,17,16,16,16,17,14],
  "D":[30,17,17,17,17,17,30],"E":[31,16,16,30,16,16,31],"F":[31,16,16,30,16,16,16],
  "G":[14,17,16,23,17,17,15],"H":[17,17,17,31,17,17,17],"I":[14,4,4,4,4,4,14],
  "J":[7,2,2,2,2,18,12],"K":[17,18,20,24,20,18,17],"L":[16,16,16,16,16,16,31],
  "M":[17,27,21,21,17,17,17],"N":[17,25,21,19,17,17,17],"O":[14,17,17,17,17,17,14],
  "P":[30,17,17,30,16,16,16],"Q":[14,17,17,17,21,18,13],"R":[30,17,17,30,20,18,17],
  "S":[15,16,16,14,1,1,30],"T":[31,4,4,4,4,4,4],"U":[17,17,17,17,17,17,14],
  "V":[17,17,17,17,17,10,4],"W":[17,17,17,21,21,21,10],"X":[17,17,10,4,10,17,17],
  "Y":[17,17,10,4,4,4,4],"Z":[31,1,2,4,8,16,31],
  "0":[14,17,19,21,25,17,14],"1":[4,12,4,4,4,4,14],"2":[14,17,1,2,4,8,31],
  "3":[30,1,1,14,1,1,30],"4":[2,6,10,18,31,2,2],"5":[31,16,16,30,1,1,30],
  "6":[14,16,16,30,17,17,14],"7":[31,1,2,4,8,8,8],"8":[14,17,17,14,17,17,14],
  "9":[14,17,17,15,1,1,14],"+":[0,4,4,31,4,4,0],"-":[0,0,0,31,0,0,0],
  ".":[0,0,0,0,0,12,12],":":[0,12,12,0,12,12,0],"/":[1,2,2,4,8,8,16],
  "_":[0,0,0,0,0,0,31]," ":[0,0,0,0,0,0,0]
};
type RGB = [number,number,number];
const WIDTH = 1200;
const HEIGHT = 630;
function setPixel(pixels: Uint8Array,x:number,y:number,color:RGB) {
  if (x<0 || y<0 || x>=WIDTH || y>=HEIGHT) return;
  const i=(y*WIDTH+x)*4;
  pixels[i]=color[0];pixels[i+1]=color[1];pixels[i+2]=color[2];pixels[i+3]=255;
}
function fillRect(pixels:Uint8Array,x:number,y:number,w:number,h:number,color:RGB) {
  const left=Math.max(0,x),top=Math.max(0,y),right=Math.min(WIDTH,x+w),bottom=Math.min(HEIGHT,y+h);
  for(let yy=top;yy<bottom;yy++){
    let i=(yy*WIDTH+left)*4;
    for(let xx=left;xx<right;xx++,i+=4){
      pixels[i]=color[0];pixels[i+1]=color[1];pixels[i+2]=color[2];pixels[i+3]=255;
    }
  }
}
function fillCircle(pixels:Uint8Array,cx:number,cy:number,r:number,color:RGB){
  for(let y=Math.max(0,cy-r);y<Math.min(HEIGHT,cy+r+1);y++){
    for(let x=Math.max(0,cx-r);x<Math.min(WIDTH,cx+r+1);x++){
      const dx=x-cx,dy=y-cy;if(dx*dx+dy*dy<=r*r)setPixel(pixels,x,y,color);
    }
  }
}
function drawText(pixels:Uint8Array,text:string,x:number,y:number,scale:number,color:RGB){
  const clean=text.toUpperCase().replace(/[^A-Z0-9+.:/_ -]/g," ").slice(0,30);
  for(let index=0;index<clean.length;index++){
    const glyph=FONT[clean[index]]||FONT[" "];
    for(let row=0;row<7;row++){
      const mask=glyph[row]||0;
      for(let col=0;col<5;col++){
        if(mask&(1<<(4-col)))fillRect(pixels,x+index*6*scale+col*scale,y+row*scale,scale,scale,color);
      }
    }
  }
}
function drawCenteredText(pixels:Uint8Array,text:string,y:number,scale:number,color:RGB){
  const clean=text.toUpperCase().replace(/[^A-Z0-9+.:/_ -]/g," ").slice(0,30);
  const width=Math.max(0,clean.length*6*scale-scale);
  drawText(pixels,clean,Math.floor((WIDTH-width)/2),y,scale,color);
}
function crc32(data:Uint8Array){
  let crc=0xffffffff;
  for(const byte of data){
    crc^=byte;
    for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
function writeU32(target:Uint8Array,offset:number,value:number){
  target[offset]=(value>>>24)&255;target[offset+1]=(value>>>16)&255;
  target[offset+2]=(value>>>8)&255;target[offset+3]=value&255;
}
function pngChunk(type:string,data:Uint8Array){
  const typeBytes=new TextEncoder().encode(type);
  const checksumInput=new Uint8Array(typeBytes.length+data.length);
  checksumInput.set(typeBytes);checksumInput.set(data,typeBytes.length);
  const chunk=new Uint8Array(12+data.length);
  writeU32(chunk,0,data.length);chunk.set(typeBytes,4);chunk.set(data,8);
  writeU32(chunk,8+data.length,crc32(checksumInput));
  return chunk;
}
async function callerPng(callerLabel:string){
  const pixels=new Uint8Array(WIDTH*HEIGHT*4);
  for(let y=0;y<HEIGHT;y++){
    const t=y/(HEIGHT-1);
    fillRect(pixels,0,y,WIDTH,1,[Math.round(7+7*t),Math.round(18+9*t),Math.round(28+8*t)]);
  }
  fillRect(pixels,68,72,1064,486,[27,38,51]);
  fillRect(pixels,78,82,1044,466,[31,46,58]);
  fillRect(pixels,78,82,1044,3,[47,201,132]);
  // Keep the accent ring compact so it never competes with the caller identity.
  fillCircle(pixels,1068,486,42,[19,70,61]);
  fillCircle(pixels,1068,486,37,[31,46,58]);
  drawText(pixels,"SERVER",112,112,4,[166,244,203]);
  drawText(pixels,"INCOMING SERVER CALL",770,124,2,[145,170,188]);
  fillCircle(pixels,600,222,62,[30,137,99]);
  fillCircle(pixels,600,222,51,[47,174,125]);
  drawCenteredText(pixels,"S",201,5,[238,255,246]);
  drawCenteredText(pixels,"CALLER IDENTIFICATION",321,3,[139,232,185]);
  const identity=callerLabel.toUpperCase().replace(/[^A-Z0-9+.:/_ -]/g," ").slice(0,26);
  const identityScale=identity.length>19?4:6;
  drawCenteredText(pixels,identity,361,identityScale,[255,255,255]);
  drawCenteredText(pixels,"IS CALLING YOU",438,4,[255,255,255]);
  drawCenteredText(pixels,"OPEN PREVIEW, TAP ANSWER",500,2,[179,207,219]);
  const rowBytes=WIDTH*4+1;
  const raw=new Uint8Array(rowBytes*HEIGHT);
  for(let y=0;y<HEIGHT;y++){
    const dest=y*rowBytes;
    raw[dest]=0;
    raw.set(pixels.subarray(y*WIDTH*4,(y+1)*WIDTH*4),dest+1);
  }
  const compressedStream=new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"));
  const compressed=new Uint8Array(await new Response(compressedStream).arrayBuffer());
  const ihdr=new Uint8Array(13);
  writeU32(ihdr,0,WIDTH);writeU32(ihdr,4,HEIGHT);
  ihdr[8]=8;ihdr[9]=6;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0;
  const signature=new Uint8Array([137,80,78,71,13,10,26,10]);
  // PNG tEXt makes the identity carried by the artwork inspectable in
  // automated acceptance tests without OCR or an external image service.
  const callerMetadata=new TextEncoder().encode("Caller="+callerLabel);
  const chunks=[signature,pngChunk("IHDR",ihdr),pngChunk("tEXt",callerMetadata),pngChunk("IDAT",compressed),pngChunk("IEND",new Uint8Array())];
  const total=chunks.reduce((sum,part)=>sum+part.length,0);
  const result=new Uint8Array(total);let offset=0;
  for(const part of chunks){result.set(part,offset);offset+=part.length;}
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", {status:405,headers});
  const url = new URL(req.url);
  const imageRequest = url.searchParams.get("image") === "1";
  const token = url.searchParams.get("token") || "";
  const inviteId = url.searchParams.get("invite_id") || "";
  if (imageRequest ? !/^[0-9a-f-]{36}$/i.test(inviteId) : (token.length < 48 || token.length > 256)) {
    return new Response("Invalid call invitation", {status:404,headers});
  }
  const projectUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = (() => {
    const raw = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
    if (raw) {
      try { const parsed = JSON.parse(raw); if (parsed && typeof parsed === "object") return parsed.default || Object.values(parsed)[0] || ""; } catch {}
    }
    return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
  })();
  if (!projectUrl || !serviceKey) return new Response("Server call preview unavailable", {status:503,headers});
  const db = createClient(projectUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  let inviteQuery = db.from("server_guest_invites")
    .select("id,call_id,expires_at,revoked_at").is("revoked_at",null).gt("expires_at",new Date().toISOString());
  inviteQuery = imageRequest ? inviteQuery.eq("id",inviteId) : inviteQuery.eq("token_hash",await sha(token));
  const {data: invite,error: inviteError} = await inviteQuery.maybeSingle();
  if (inviteError) {
    console.error("GUEST_PREVIEW_INVITE_LOOKUP_FAILED");
    return new Response("Server call preview temporarily unavailable.",{status:503,headers});
  }
  if (!invite) return new Response("This Server call invitation has expired.",{status:410,headers});
  const {data: call,error: callError} = await db.from("server_calls")
    .select("state,expires_at,caller_user_id").eq("id",invite.call_id).maybeSingle();
  if (callError) {
    console.error("GUEST_PREVIEW_CALL_LOOKUP_FAILED");
    return new Response("Server call preview temporarily unavailable.",{status:503,headers});
  }
  if (!call || !["ringing","connecting"].includes(call.state) ||
      (call.expires_at && Date.parse(call.expires_at) <= Date.now())) {
    return new Response("This Server call is no longer ringing.",{status:410,headers});
  }
  const {data: profile,error:profileError} = await db.from("server_profiles")
    .select("server_id,phone_e164,phone_verified_at,allow_number_based_server_calls").eq("user_id",call.caller_user_id).maybeSingle();
  if (profileError) {
    console.error("GUEST_PREVIEW_CALLER_PROFILE_LOOKUP_FAILED");
    return new Response("Server call preview temporarily unavailable.",{status:503,headers});
  }
  const phoneMayBeShown = profile?.phone_verified_at && profile?.allow_number_based_server_calls === true &&
    typeof profile.phone_e164 === "string" && /^\+[1-9][0-9]{7,14}$/.test(profile.phone_e164);
  const caller = phoneMayBeShown ? profile.phone_e164 : "PRIVATE CALLER";

  if (imageRequest) {
    if (req.method === "HEAD") return new Response(null,{status:200,headers:{
      "content-type":"image/png","cache-control":"private, no-store, max-age=0",
      "x-content-type-options":"nosniff","x-robots-tag":"noindex,nofollow"
    }});
    const png = await callerPng(caller);
    return new Response(png,{status:200,headers:{
      "content-type":"image/png","cache-control":"private, no-store, max-age=0",
      "content-length":String(png.length),"x-content-type-options":"nosniff",
      "x-robots-tag":"noindex,nofollow","access-control-allow-origin":"*"
    }});
  }

  const title = caller + " is calling you through Server";
  const description = caller + " is trying to reach you via Server. Open this preview and tap Answer to connect by internet voice.";
  const guestUrl = "https://server-onboarding-ochre.vercel.app/guest.html#token=" + encodeURIComponent(token);
  const imageUrl = projectUrl.replace(/\/$/,"") + "/functions/v1/server-guest-preview?image=1&invite_id=" + encodeURIComponent(invite.id);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#101b2a">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="SERVER">
<meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(imageUrl)}"><meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}">
<meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escapeHtml("Incoming Server call from " + caller)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(imageUrl)}">
<meta name="twitter:image:alt" content="${escapeHtml("Incoming Server call from " + caller)}">
</head><body style="margin:0;min-height:100vh;background:#101b2a;color:white;font:600 18px system-ui;display:grid;place-items:center;text-align:center">
<main style="padding:28px;max-width:560px"><div style="color:#9ff0c4;letter-spacing:.2em;font-weight:900">SERVER · INCOMING CALL</div>
<h1 style="font-size:clamp(32px,7vw,54px);line-height:1.05">${escapeHtml(caller)} is calling you</h1>
<p>Tap below to open the secure call screen, then press Answer.</p><a href="${guestUrl}" style="display:inline-block;padding:18px 32px;border-radius:40px;background:#20ad59;color:white;text-decoration:none">Open incoming call</a></main>
<script>location.replace(${JSON.stringify(guestUrl)});</script></body></html>`;
  return new Response(req.method==="HEAD"?null:html,{status:200,headers});
});
