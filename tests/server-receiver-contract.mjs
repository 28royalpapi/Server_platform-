import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const [migration,lifetimeMigration,edge,calls,page,client,sw,manifest,android,setup,onboarding,onboardingApp,config,pkg,guestPage,push]=await Promise.all([
 readFile("supabase/migrations/20261120190906_server_receiver_persistent_enrolment.sql","utf8"),
 readFile("supabase/migrations/20261122080000_server_receiver_invites_do_not_expire.sql","utf8"),
 readFile("supabase/functions/server-receiver/index.ts","utf8"),
 readFile("supabase/functions/server-calls/index.ts","utf8"),
 readFile("web/receiver.html","utf8"),readFile("web/receiver.js","utf8"),
 readFile("web/server-guest-sw.js","utf8"),readFile("web/receiver.webmanifest","utf8"),
 readFile("apps/android-caller/app/src/main/java/com/server/caller/MainActivity.kt","utf8"),
 readFile("apps/android-caller/app/src/main/java/com/server/caller/ServerSetupWebActivity.kt","utf8"),
 readFile("web/index.html","utf8"),readFile("web/app.js","utf8"),
 readFile("supabase/config.toml","utf8"),readFile("package.json","utf8"),
 readFile("web/guest.js","utf8"),
 readFile("supabase/functions/_shared/guest_web_push.ts","utf8")
]);
assert.match(migration,/create table if not exists public\.server_receiver_invites/i);
assert.match(migration,/enable row level security/i);
assert.match(migration,/revoke all on public\.server_receiver_invites from anon,authenticated/i);
assert.match(migration,/receiver_secret_hash/i);
assert.match(lifetimeMigration,/alter column expires_at drop not null/i);
assert.match(lifetimeMigration,/expires_at = null/i);
assert.match(edge,/crypto\.subtle\.digest\("SHA-256"/);
assert.match(edge,/\.is\("claimed_at",null\)/);
assert.match(edge,/b\.consent!==true/);
assert.match(edge,/receiver_secret_hash/);
assert.match(edge,/RECEIVER_DEVICE_ALREADY_BOUND/);
assert.match(edge,/ignoreDuplicates:true/);
assert.match(edge,/action==="revoke"/);
assert.match(edge,/server_guest_push_config/);
assert.match(edge,/action==="create_invites"\|\|action==="list"/);
assert.match(edge,/x-server-session-token/);
assert.match(edge,/server_sessions/);
assert.match(edge,/RECIPIENTS_MUST_BE_1_TO_20/);
assert.match(edge,/RECEIVER_INVITE_DAILY_LIMIT/);
assert.match(edge,/status:"registered"/);
assert.match(edge,/action==="renew_config"\|\|action==="renew"/);
assert.match(edge,/RECEIVER_DEVICE_NOT_RENEWABLE/);
assert.match(edge,/status:"needs_attention"/);
assert.match(edge,/needs_attention_count/);
assert.match(edge,/repair_url:"https:\/\/server-onboarding-ochre\.vercel\.app\/receiver\.html"/);
assert.match(edge,/needs_repair:true,expired:true/);
assert.match(push,/expiration_at:\s*new Date\(\)\.toISOString\(\)/);
assert.match(client,/async function renewReceiver\(\)/);
assert.match(client,/api\("renew_config"/);
assert.match(client,/api\("renew"/);
assert.match(client,/Repair call alerts/);
assert.match(edge,/RECEIVER_REVOKE_SYNC_FAILED/);
assert.match(android,/Manage Server Receivers/);
assert.match(android,/Add people as Receivers/);
assert.match(android,/View my Receiver list/);
assert.match(setup,/loadReceiverContacts/);
assert.match(setup,/ContactsContract\.CommonDataKinds\.Phone/);
assert.match(setup,/createReceiverInvitations/);
assert.match(setup,/REQUEST_RECEIVER_CONTACTS/);
assert.match(setup,/requestServerReceiver/);
assert.match(setup,/copyReceiverInvitation/);
assert.match(onboarding,/id="receiver-onboarding"/);
assert.match(onboarding,/Show my contacts/);
assert.match(onboarding,/invite-selected-receivers/);
assert.match(onboardingApp,/onServerReceiverContactsResult/);
assert.match(onboardingApp,/onServerReceiverRegistryResult/);
assert.match(onboardingApp,/Share existing link/);
assert.match(onboardingApp,/Generate links for selected people/);
assert.doesNotMatch(setup,/needed\.add\(Manifest\.permission\.READ_CONTACTS\)/);
assert.match(android,/receiverApiAsync\("create_invites"/);
assert.match(android,/receiverApiAsync\("list"/);
assert.match(calls,/const guestPush=await sendGuestBrowserPush\(db,to/);
assert.match(calls,/registered_devices:guestPush\.registered/);
assert.doesNotMatch(edge,/\.\/_shared\//);
assert.doesNotMatch(edge,/7\*24\*60\*60\*1000/);
assert.match(edge,/const expiresAt=null/);
assert.match(edge,/expires_at\.is\.null/);
assert.ok(edge.includes('pending_count:receivers.filter((r:any)=>r.status==="pending").length'));
assert.ok(edge.includes('attention_count:receivers.filter((r:any)=>["expired","revoked","needs_attention"].includes(r.status)).length'));
assert.match(edge,/token_hash:await sha\(token\)/);
assert.match(edge,/receiver\.html#token=/);
assert.doesNotMatch(calls,/create_receiver_invite/);
assert.match(page,/id="enable-receiver"/);
assert.match(client,/invalid or has been revoked/);
assert.match(page,/No phone number to type/);
assert.match(client,/Notification\.requestPermission\(\)/);
assert.match(client,/pushManager\.subscribe/);
assert.match(client,/api\("claim"/);
assert.match(client,/device_secret/);
assert.match(client,/Add Server Receiver to your Home Screen/);
assert.match(sw,/server-guest-shell-v4/);
assert.match(sw,/receiver\.html/);
assert.match(sw,/server_guest_incoming_call/);
assert.ok(sw.includes('actions:[{action:"answer",title:"Answer"},{action:"decline",title:"Decline"}]'));
assert.ok(sw.includes('sameOriginTarget.searchParams.set("server_action","answer")'));
assert.ok(sw.includes('sameOriginTarget.searchParams.set("server_action","decline")'));
assert.ok(guestPage.includes('notificationAction=url.searchParams.get("server_action")'));
assert.ok(guestPage.includes("joinButton.focus"));
assert.ok(guestPage.includes('notificationAction==="decline"'));
assert.match(android,/Manage Server Receivers/);
assert.match(android,/receiverApiAsync\("create_invites"/);
assert.match(config,/\[functions\.server-receiver\]/);
assert.equal(JSON.parse(manifest).start_url,"/receiver.html");
assert.match(JSON.parse(pkg).scripts.check,/server-receiver-contract/);
assert.match(android,/Invite from phone contacts/);
assert.match(android,/ContactsContract\.CommonDataKinds\.Phone/);
assert.match(android,/showReceiverContactsPicker/);
assert.match(android,/rememberReceiverContactNames/);
console.log("PASS Server Receiver static contract — invite, consent, persistence, contacts, push reuse, revocation and Android caller entry point.");
