import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, deliveryMigration, edge, serverCalls, guestPush, manifest, activity, screening, roster, worker, gradle, workflow, page, client, callerManifest, callerActivity, callerEngine, wakeSender] = await Promise.all([
  readFile("supabase/migrations/20261123190000_server_receiver_native_companion.sql", "utf8"),
  readFile("supabase/migrations/20261124070000_server_receiver_offline_wake_delivery.sql", "utf8"),
  readFile("supabase/functions/server-receiver/index.ts", "utf8"),
  readFile("supabase/functions/server-calls/index.ts", "utf8"),
  readFile("supabase/functions/_shared/guest_web_push.ts", "utf8"),
  readFile("apps/android-receiver/app/src/main/AndroidManifest.xml", "utf8"),
  readFile("apps/android-receiver/app/src/main/java/com/server/receiver/MainActivity.kt", "utf8"),
  readFile("apps/android-receiver/app/src/main/java/com/server/receiver/ServerWakeCallScreeningService.kt", "utf8"),
  readFile("apps/android-receiver/app/src/main/java/com/server/receiver/ServerReceiverRoster.kt", "utf8"),
  readFile("apps/android-receiver/app/src/main/java/com/server/receiver/ServerRosterRefreshWorker.kt", "utf8"),
  readFile("apps/android-receiver/app/build.gradle.kts", "utf8"),
  readFile(".github/workflows/server-receiver-companion-build.yml", "utf8"),
  readFile("web/receiver.html", "utf8"),
  readFile("web/receiver.js", "utf8"),
  readFile("apps/android-caller/app/src/main/AndroidManifest.xml", "utf8"),
  readFile("apps/android-caller/app/src/main/java/com/server/caller/MainActivity.kt", "utf8"),
  readFile("apps/android-caller/app/src/main/java/com/server/caller/ServerTelecomCallEngine.kt", "utf8"),
  readFile("apps/android-caller/app/src/main/java/com/server/caller/ServerOfflineWakeCall.kt", "utf8")
]);

assert.match(migration, /server_receiver_native_pair_codes/);
assert.match(migration, /server_receiver_native_devices/);
assert.match(migration, /enable row level security/);
assert.match(deliveryMigration, /add column if not exists ready_at/);
assert.match(deliveryMigration, /server_calls_guest_receiver_lookup_idx/);
assert.match(edge, /action==="native_pair"/);
assert.match(edge, /action==="native_claim"/);
assert.match(edge, /action==="native_roster"/);
assert.match(edge, /action==="native_revoke"/);
assert.match(edge, /caller_hash/);
assert.ok(edge.includes('if(!/^\\+[1-9][0-9]{7,14}$/.test(phone))continue;'), "native caller roster must accept E.164 plus-prefixed numbers");
assert.match(edge, /receiver_secret_hash/);
assert.match(edge, /RECEIVER_NATIVE_REVOKE_SYNC_FAILED/);
assert.match(edge, /RECEIVER_NATIVE_READY_STATE_FAILED/);
assert.match(edge, /ready_at:b\.ready===true\?now:null/);
assert.match(edge, /action==="native_pending_call"/);
assert.match(edge, /exclude_call_id/);
assert.match(edge, /server_guest_invites/);
assert.match(edge, /invitation_url:/);
assert.match(serverCalls, /b\.offline_wake_enabled===true/);
assert.match(serverCalls, /nativeWakeAvailable/);
assert.match(serverCalls, /ready_at/);
assert.match(serverCalls, /GUEST_CALL_TTL_SECONDS = 5 \* 60/);
assert.match(serverCalls, /GUEST_INVITE_TTL_SECONDS = 5 \* 60/);
assert.match(guestPush, /options: \{ ttl: 300, urgency: "high" \}/);
assert.match(manifest, /android\.telecom\.CallScreeningService/);
assert.match(manifest, /BIND_SCREENING_SERVICE/);
assert.match(manifest, /READ_CONTACTS/);
assert.match(activity, /ROLE_CALL_SCREENING/);
assert.match(activity, /ServerReceiverRoster\.claimPair/);
assert.match(activity, /PeriodicWorkRequestBuilder/);
assert.match(screening, /respondToCall/);
assert.match(screening, /DIRECTION_INCOMING/);
assert.match(screening, /setDisallowCall\(true\)/);
assert.match(screening, /showWakeNotification/);
assert.match(roster, /HmacSHA256/);
assert.match(roster, /AndroidKeyStore/);
assert.match(roster, /AES\/GCM\/NoPadding/);
assert.match(roster, /native_claim/);
assert.match(roster, /native_roster/);
assert.match(roster, /pendingGuestCall/);
assert.match(roster, /excludeCallId/);
assert.match(roster, /native_pending_call/);
assert.match(roster, /fun isReady/);
assert.match(roster, /READ_CONTACTS/);
assert.match(roster, /POST_NOTIFICATIONS/);
assert.match(activity, /resumePendingCall/);
assert.match(activity, /pendingGuestCall\(this, nativeSecret, previousCall\)/);
assert.match(activity, /override fun onResume/);
assert.match(activity, /PeriodicWorkRequestBuilder<ServerRosterRefreshWorker>\(15, TimeUnit.MINUTES\)/);
assert.match(callerManifest, /android\.permission\.CALL_PHONE/);
assert.match(callerManifest, /android\.permission\.READ_PHONE_NUMBERS/);
assert.match(callerActivity, /offline_wake_enabled/);
assert.match(callerActivity, /ServerOfflineWakeCall\.place/);
assert.match(callerActivity, /carrier may charge/);
assert.match(callerEngine, /ServerOfflineWakeCall\.place/);
assert.match(wakeSender, /\.placeCall\(/);
assert.match(wakeSender, /getDefaultOutgoingPhoneAccount/);
assert.match(wakeSender, /callCapablePhoneAccounts/);
assert.match(wakeSender, /CAPABILITY_SIM_SUBSCRIPTION/);
assert.match(wakeSender, /VERIFIED_CALLER_SIM_NOT_FOUND/);
assert.match(wakeSender, /matchingAccounts/);
assert.match(wakeSender, /READ_PHONE_NUMBERS/);
assert.match(wakeSender, /verifiedCallerE164/);
assert.match(wakeSender, /CALLER_CONSENT_REQUIRED/);
assert.match(roster, /normalizeE164/);
assert.match(roster, /NET_CAPABILITY_VALIDATED/);
assert.match(worker, /ServerReceiverRoster\.sync/);
assert.match(gradle, /work-runtime-ktx/);
assert.match(workflow, /assembleDebug/);
assert.match(workflow, /apksigner" verify/);
const receiverSmoke = await readFile("apps/android-receiver/app/src/androidTest/java/com/server/receiver/OfflineWakeReceiverSmokeTest.kt", "utf8");
assert.match(receiverSmoke, /Server Caller C/);
assert.match(receiverSmoke, /matchedOtherCaller/);
assert.match(receiverSmoke, /gsmWakeCallFromDifferentServerCallerProducesServerNotification/);
assert.match(workflow, /gsm call \+2348098765432/);
assert.match(workflow, /gsmWakeCallFromDifferentServerCallerProducesServerNotification/);
assert.match(page, /offline-wake-companion/);
assert.match(client, /native_pair/);
assert.match(client, /serverreceiver:\/\/pair/);
console.log("PASS Server offline Receiver contract — caller SIM wake handoff, one-time pairing, keyed caller roster, pending WebRTC recovery, and Android build.");
