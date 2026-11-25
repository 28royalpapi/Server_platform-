const CACHE_NAME="server-guest-shell-v2";
const APP_SHELL=["/guest.html","/guest.css","/guest.js","/offline-inbox.js","/config.js","/manifest.webmanifest","/images/server-app-icon.svg"];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith("server-guest-shell-")&&key!==CACHE_NAME).map(key=>caches.delete(key)));await self.clients.claim();})()));
self.addEventListener("fetch",event=>{const request=event.request;if(request.method!=="GET")return;const url=new URL(request.url);if(url.origin!==self.location.origin||(!APP_SHELL.includes(url.pathname)&&url.pathname!=="/guest.html"))return;event.respondWith((async()=>{const cache=await caches.open(CACHE_NAME);const cached=await cache.match(request);try{const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;}catch{return cached||Response.error();}})());});
self.addEventListener("push",event=>{
 let payload={};
 try{payload=event.data?event.data.json():{};}catch{try{payload=JSON.parse(event.data?.text()||"{}");}catch{}}
 if(payload.type!=="server_guest_incoming_call")return;
 const title=String(payload.title||"Incoming Server call").slice(0,100);
 const body=String(payload.body||"Someone is calling you through Server.").slice(0,220);
 const target=typeof payload.url==="string"&&payload.url.startsWith("https://")
  ?payload.url:"https://server-onboarding-ochre.vercel.app/guest.html";
 event.waitUntil(self.registration.showNotification(title,{
  body,tag:"server-guest-"+String(payload.call_id||Date.now()).slice(0,80),
  renotify:true,requireInteraction:true,vibrate:[0,450,180,450],
  data:{url:target,call_id:String(payload.call_id||"")}
 }));
});
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 const target=event.notification.data?.url;
 if(typeof target!=="string"||!target.startsWith("https://"))return;
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  const sameOriginTarget=new URL(target,self.location.origin);
  if(sameOriginTarget.origin!==self.location.origin)return;
  const existing=windows.find(client=>client.url.startsWith(self.location.origin));
  if(existing){await existing.navigate(sameOriginTarget.href);await existing.focus();return;}
  await self.clients.openWindow(sameOriginTarget.href);
 })());
});
