importScripts("https://www.gstatic.com/firebasejs/11.0.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging-compat.js");
importScripts("/config.js");

const config=self.SERVER_CONFIG&&self.SERVER_CONFIG.firebase;
if(config&&config.apiKey&&config.projectId&&config.messagingSenderId&&config.appId){
  firebase.initializeApp(config);
  const messaging=firebase.messaging();
  messaging.onBackgroundMessage(payload=>{
    const data=payload.data||{};
    if(data.type!=="server_guest_incoming_call"||!data.url)return;
    self.registration.showNotification("SERVER · Incoming call",{
      body:(data.caller_label||"A Server user")+" is calling you through Server. Tap to answer.",
      tag:"server-"+(data.call_id||"call"),
      renotify:true,
      requireInteraction:true,
      data:{url:data.url}
    });
  });
}
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=event.notification.data&&event.notification.data.url;
  if(!target)return;
  event.waitUntil((async()=>{
    const windows=await clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of windows){
      if("focus" in client){await client.navigate(target);return client.focus();}
    }
    return clients.openWindow(target);
  })());
});
