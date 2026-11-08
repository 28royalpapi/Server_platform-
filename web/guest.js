const cfg=window.SERVER_CONFIG||{};
const url=new URL(location.href);
const fragmentToken=url.hash.startsWith("#token=")?decodeURIComponent(url.hash.slice(7)):"";
const inviteToken=url.searchParams.get("token")||fragmentToken||"";
history.replaceState(null,"",location.pathname);
const statusEl=document.querySelector("#guest-status"),joinButton=document.querySelector("#join-call"),leaveButton=document.querySelector("#leave-call"),declineButton=document.querySelector("#decline-call"),audioEl=document.querySelector("#remote-audio"),descriptionEl=document.querySelector("#guest-description");
let pc=null,localStream=null,lastSeq=0,polling=false,leaving=false,pendingIce=[],callId="",iceConnected=false,remoteAudioReceived=false,activeReported=false,realtimeClient=null,realtimeConnected=false;
let inviteFingerprint="",lastInviteDoc=null,lastMediaStatsAt=0,mediaStatsCheckPending=false;
const titleEl=document.querySelector("#guest-title");
function fallbackCacheKey(){return "server.guest.inbox.v1."+inviteFingerprint;}
function readFallbackInvite(){try{return JSON.parse(localStorage.getItem(fallbackCacheKey())||"null");}catch{return null;}}
function writeFallbackInvite(doc){try{localStorage.setItem(fallbackCacheKey(),JSON.stringify(doc));}catch{}}
async function fingerprintToken(value){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,"0")).join("");}
function toInviteDoc(details){const call=details.call||{};return {id:inviteFingerprint,call_id:String(details.call_id||call.id||""),caller_server_id:String(details.caller_label||details.caller_phone||details.caller_server_id||"A Server user").slice(0,80),state:String(call.state||"ringing"),joined:details.joined===true,created_at:call.created_at||new Date().toISOString(),updated_at:call.updated_at||call.created_at||new Date().toISOString(),invite_expires_at:details.expires_at||""};}
async function saveInviteLocally(details){const doc=toInviteDoc(details);lastInviteDoc=doc;writeFallbackInvite(doc);try{const store=await import("./offline-inbox.js");await store.syncGuestInvite(inviteFingerprint,async()=>doc);}catch(err){console.info("RxDB guest cache unavailable; retaining the local metadata fallback.");}return doc;}
async function readInviteLocally(){const fallback=readFallbackInvite();try{const store=await import("./offline-inbox.js");const cached=await store.getGuestInvite(inviteFingerprint);if(cached)return cached;}catch{}return fallback;}
function renderInvite(details,isCached=false){
 const call=details.call||details;const state=String(call.state||details.state||"");const caller=String(details.caller_label||details.caller_phone||details.caller_server_id||"A Server user");
 if(state==="missed"){titleEl.textContent="Missed Server call";descriptionEl.textContent=caller+" tried to reach you through Server, but the live call window ended. The invitation receipt remains available for up to 24 hours.";status(isCached?"Saved missed-call details are available on this device.":"This is a missed call, not a live ringing session.");joinButton.disabled=true;return;}
 if(state==="ended"||state==="failed"){titleEl.textContent="Call ended";descriptionEl.textContent="The Server call has ended. Ask the caller to start another call.";status("This call is no longer available.",true);joinButton.disabled=true;declineButton.disabled=true;return;}
 if(details.joined===true){titleEl.textContent="Server call already answered";descriptionEl.textContent="This one-time invitation has already been answered in another browser or on another device. Continue on that device or ask the caller to start a new call.";status("This invitation has already been claimed.",true);joinButton.disabled=true;declineButton.disabled=true;return;}
 titleEl.textContent=caller+" is calling you";descriptionEl.textContent=caller+" is calling you through Server. Answer to connect by internet voice. You do not need to install Server or create an account.";
 if(isCached){status("This invitation was saved on this device. Reconnect to check whether the caller is still waiting.",true);joinButton.disabled=true;}else{status("Invitation verified. Answer to enable your microphone.");joinButton.disabled=false;}
}
function status(message,isError=false){statusEl.textContent=message;statusEl.classList.toggle("is-error",isError);statusEl.classList.remove("hidden");}
async function api(action,extras={}){if(!cfg.supabaseUrl||!cfg.publishableKey||String(cfg.supabaseUrl).includes("YOUR_PROJECT"))throw new Error("Guest calling is not connected to the Server backend.");const response=await fetch(cfg.supabaseUrl+"/functions/v1/server-guest",{method:"POST",headers:{"content-type":"application/json",apikey:cfg.publishableKey},body:JSON.stringify(Object.assign({action,token:inviteToken},extras))});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||("Call service error ("+response.status+")"));return result;}
async function sendSignal(kind,payload={}){if(leaving)return;try{await api("signal",{call_id:callId,kind,payload});}catch(err){status("Could not send call signal: "+err.message,true);}}
async function maybeReportMediaReady(){
 if(!iceConnected||!remoteAudioReceived||activeReported||mediaStatsCheckPending||!pc)return;
 const now=Date.now();if(now-lastMediaStatsAt<1000)return;
 lastMediaStatsAt=now;mediaStatsCheckPending=true;
 try{
  const report=await pc.getStats();
  let inboundAudioPackets=0,outboundAudioPackets=0,inboundAudioEnergy=0,outboundAudioEnergy=0;
  report.forEach(stat=>{
   if(stat.kind!=="audio"&&stat.mediaType!=="audio")return;
   if(stat.type==="inbound-rtp"){
    inboundAudioPackets+=Number(stat.packetsReceived)||0;
    // Received-track energy is part of inbound-rtp statistics.
    inboundAudioEnergy+=Number(stat.totalAudioEnergy)||0;
   }else if(stat.type==="outbound-rtp"){
    // Outbound RTP exposes packetsSent, but not totalAudioEnergy.
    outboundAudioPackets+=Number(stat.packetsSent)||0;
   }else if(stat.type==="media-source"){
    // Local microphone capture energy is exposed as RTCAudioSourceStats.
    outboundAudioEnergy+=Number(stat.totalAudioEnergy)||0;
   }
  });
  if(inboundAudioPackets>0&&outboundAudioPackets>0&&inboundAudioEnergy>0&&outboundAudioEnergy>0&&!activeReported){
   activeReported=true;
   status("Connected. Audio is flowing in both directions.");
   void sendSignal("state",{state:"active"});
  }else{
   status("Checking microphone capture and incoming audio…");
  }
 }catch(err){status("Checking microphone capture and incoming audio…");}
 finally{mediaStatsCheckPending=false;}
}
async function loadInvitation(){
 if(!inviteToken||inviteToken.length<48){status("This invitation link is missing its secure token. Ask the caller to send a new invitation.",true);joinButton.disabled=true;return;}
 try{inviteFingerprint=await fingerprintToken(inviteToken);}catch{status("This browser cannot create a secure local invitation reference.",true);joinButton.disabled=true;return;}
 const cached=await readInviteLocally();
 if(!navigator.onLine){if(cached){lastInviteDoc=cached;renderInvite(cached,true);status("You are offline. This is the last saved state; reconnect before trying to answer.",true);}else status("You are offline. Reopen this invitation after your internet connection returns.",true);joinButton.disabled=true;return;}
 try{const details=await api("inspect");const doc=await saveInviteLocally(details);renderInvite(details,false);if(doc.state==="missed")joinButton.disabled=true;}
 catch(err){const latest=await readInviteLocally();if(latest){lastInviteDoc=latest;renderInvite(latest,true);status("Server could not be reached. Showing the invitation saved on this device.",true);}else{status("This Server invitation could not be verified: "+err.message,true);joinButton.disabled=true;}}
}
async function onSignal(signal){if(signal.kind==="hangup"){status("The other person ended the call.");await cleanup(false);return;}if(!pc)return;try{if(signal.kind==="offer"){await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));for(const candidate of pendingIce)await pc.addIceCandidate(new RTCIceCandidate(candidate));pendingIce=[];const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await sendSignal("answer",pc.localDescription.toJSON());status("Negotiating audio connection…");}else if(signal.kind==="ice"&&signal.payload?.candidate){if(pc.remoteDescription)await pc.addIceCandidate(new RTCIceCandidate(signal.payload));else pendingIce.push(signal.payload);}else if(signal.kind==="state"&&signal.payload?.state==="active")status("Audio connection active. Keep this page open.");}catch(err){status("Call negotiation failed: "+err.message,true);}}
async function applyRealtimeEvent(message){
 if(!message||message.call_id&&message.call_id!==callId)return;
 if(message.type==="signal"){
  const seq=Number(message.seq)||0;if(seq<=lastSeq)return;lastSeq=seq;
  await onSignal({kind:message.kind,payload:message.payload||{},seq});
 }else if(message.type==="call_state"){
  if(["ended","failed","missed"].includes(String(message.state||""))||message.kind==="hangup"){
   status("The other person ended the call.");await cleanup(false);
  }else if(message.state==="active"){status("Audio connection active. Keep this page open.");}
 }
}
async function pollOnce(){
 const result=await api("poll",{after_seq:lastSeq});
 for(const signal of result.signals||[]){
  const seq=Number(signal.seq)||0;if(seq<=lastSeq)continue;lastSeq=seq;await onSignal(signal);
 }
 if(result.call?.state==="ended"||result.call?.state==="failed"||result.call?.state==="missed"){
  status("This call has ended.");await cleanup(false);
 }
}
async function connectRealtime(){
 try{
  const credentials=await api("realtime_token");
  if(credentials.realtime_available!==true||!credentials.url||!credentials.token)return false;
  const Centrifuge = await new Promise((resolve, reject) => {
   if(typeof window.Centrifuge==="function"){resolve(window.Centrifuge);return;}
   const script=document.createElement("script");
   script.src="https://unpkg.com/centrifuge@5.8.0/dist/centrifuge.js";
   script.async=true;
   script.onload=()=>typeof window.Centrifuge==="function"?resolve(window.Centrifuge):reject(new Error("Centrifuge SDK did not expose its browser client."));
   script.onerror=()=>reject(new Error("Could not load the Centrifuge browser SDK."));
   document.head.appendChild(script);
  });
  if(leaving)return false;
  const client=new Centrifuge(credentials.url,{
   token:credentials.token,
   getToken:async()=>{const refreshed=await api("realtime_token");if(refreshed.realtime_available!==true||!refreshed.token)throw new Error("Realtime token refresh is unavailable.");return refreshed.token;}
  });
  realtimeClient=client;
  client.on("publication",ctx=>{void applyRealtimeEvent(ctx.data).catch(err=>status("Realtime event error: "+err.message,true));});
  client.on("connected",async()=>{
   try{
    await pollOnce();
    if(!leaving&&realtimeClient===client){realtimeConnected=true;status("Secure realtime channel connected. Waiting for call audio…");}
   }catch(err){realtimeConnected=false;status("Realtime connected; reconciling saved call events…",true);}
  });
  client.on("disconnected",()=>{
   realtimeConnected=false;
   status("Realtime connection interrupted. Reconnecting…",true);
  });
  client.connect();
  return true;
 }catch(err){
  realtimeConnected=false;
  status("Realtime service unavailable; using compatibility signalling: "+err.message,true);
  return false;
 }
}
async function pollLoop(){
 if(polling)return;polling=true;
 while(!leaving){
  try{
   await maybeReportMediaReady();
   if(!realtimeConnected)await pollOnce();
  }catch(err){status("Connection interrupted: "+err.message,true);}
  await new Promise(r=>setTimeout(r,realtimeConnected?1000:650));
 }
 polling=false;
}
async function cleanup(notify){if(leaving)return;leaving=true;realtimeConnected=false;iceConnected=false;remoteAudioReceived=false;activeReported=false;if(notify&&inviteToken){try{await api("leave");}catch{}}try{realtimeClient?.disconnect();realtimeClient?.close();}catch{}realtimeClient=null;try{pc?.close();}catch{}localStream?.getTracks().forEach(t=>t.stop());pc=null;localStream=null;joinButton.classList.remove("hidden");leaveButton.classList.add("hidden");joinButton.disabled=true;}
declineButton.addEventListener("click",async()=>{declineButton.disabled=true;joinButton.disabled=true;status("Declining call…");try{await api("decline");titleEl.textContent="Call declined";descriptionEl.textContent="You declined this Server call.";status("The caller has been notified.");}catch(err){status("Could not decline the call: "+err.message,true);declineButton.disabled=false;joinButton.disabled=false;}});
joinButton.addEventListener("click",async()=>{joinButton.disabled=true;try{if(inviteToken.length<48)throw new Error("This invitation link is missing or invalid.");if(!navigator.mediaDevices?.getUserMedia)throw new Error("Open this link in an up-to-date browser over HTTPS.");status("Requesting microphone permission…");localStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});const joined=await api("join");callId=joined.call.id;activeReported=false;pc=new RTCPeerConnection({iceServers:joined.ice_servers||[{urls:"stun:stun.cloudflare.com:3478"},{urls:"stun:stun.l.google.com:19302"}],iceTransportPolicy:joined.ice_server_mode&&joined.ice_server_mode!=="stun-only"?"relay":"all"});localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));window.__serverGuestPeerConnection=pc;pc.ontrack=e=>{if(e.track.kind!=="audio")return;audioEl.srcObject=e.streams[0]||new MediaStream([e.track]);e.track.onunmute=()=>{remoteAudioReceived=true;maybeReportMediaReady();};audioEl.play().catch(()=>status("Tap the page once to allow audio playback."));};pc.onicecandidate=e=>{if(e.candidate)void sendSignal("ice",e.candidate.toJSON());};pc.onconnectionstatechange=()=>{if(pc?.connectionState==="connected"){iceConnected=true;status(remoteAudioReceived?"Connected. Two-way audio is ready.":"Network connected; waiting for remote audio…");maybeReportMediaReady();}if(pc?.connectionState==="disconnected"){iceConnected=false;status("Connection interrupted. Trying to recover…",true);}if(pc?.connectionState==="failed"){iceConnected=false;status("The network could not establish a peer connection. A TURN relay may be required on this network.",true);}};joinButton.classList.add("hidden");declineButton.classList.add("hidden");leaveButton.classList.remove("hidden");leaveButton.disabled=false;status("Waiting for the Server caller. Internet access is required.");leaving=false;void connectRealtime();void pollLoop();}catch(err){status(err.message||"Could not join this call.",true);localStream?.getTracks().forEach(t=>t.stop());localStream=null;joinButton.disabled=false;}});
leaveButton.addEventListener("click",async()=>{leaveButton.disabled=true;status("Leaving call…");await cleanup(true);status("You left the call.");});
if("serviceWorker" in navigator && location.protocol==="https:")navigator.serviceWorker.register("/server-guest-sw.js",{scope:"/"}).catch(()=>{});
void loadInvitation();
