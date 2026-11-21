import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const [migration,edge,calls,page,client,sw,manifest,android,config,pkg]=await Promise.all([
 readFile("supabase/migrations/20261120190906_server_receiver_persistent_enrolment.sql","utf8"),
 readFile("supabase/functions/server-receiver/index.ts","utf8"),
 readFile("supabase/functions/server-calls/index.ts","utf8"),
 readFile("web/receiver.html","utf8"),readFile("web/receiver.js","utf8"),
 readFile("web/server-guest-sw.js","utf8"),readFile("web/receiver.webmanifest","utf8"),
 readFile("apps/android-caller/app/src/main/java/com/server/caller/MainActivity.kt","utf8"),
 readFile("supabase/config.toml","utf8"),readFile("package.json","utf8")
]);
assert.match(migration,/create table if not exists public\.server_receiver_invites/i);
assert.match(migration,/enable row level security/i);
assert.match(migration,/revoke all on public\.server_receiver_invites from anon,authenticated/i);
assert.match(migration,/receiver_secret_hash/i);
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
assert.match(edge,/RECEIVER_REVOKE_SYNC_FAILED/);
assert.match(android,/Manage Server Receivers/);
assert.match(android,/Add people as Receivers/);
assert.match(android,/View my Receiver list/);
assert.match(android,/receiverApiAsync\("create_invites"/);
assert.match(android,/receiverApiAsync\("list"/);
assert.match(calls,/const guestPush=await sendGuestBrowserPush\(db,to/);
assert.match(calls,/registered_devices:guestPush\.registered/);
assert.doesNotMatch(edge,/\.\/_shared\//);
assert.match(edge,/7\*24\*60\*60\*1000/);
assert.match(edge,/token_hash:await sha\(token\)/);
assert.match(edge,/receiver\.html#token=/);
assert.doesNotMatch(calls,/create_receiver_invite/);
assert.match(page,/id="enable-receiver"/);
assert.match(page,/No phone number to type/);
assert.match(client,/Notification\.requestPermission\(\)/);
assert.match(client,/pushManager\.subscribe/);
assert.match(client,/api\("claim"/);
assert.match(client,/device_secret/);
assert.match(client,/Add Server Receiver to your Home Screen/);
assert.match(sw,/server-guest-shell-v3/);
assert.match(sw,/receiver\.html/);
assert.match(sw,/server_guest_incoming_call/);
assert.match(android,/Manage Server Receivers/);
assert.match(android,/receiverApiAsync\("create_invites"/);
assert.match(config,/\[functions\.server-receiver\]/);
assert.equal(JSON.parse(manifest).start_url,"/receiver.html");
assert.match(JSON.parse(pkg).scripts.check,/server-receiver-contract/);
console.log("PASS Server Receiver static contract — invite, consent, persistence, push reuse, revocation and Android caller entry point.");
