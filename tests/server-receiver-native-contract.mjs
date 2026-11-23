import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, edge, manifest, activity, screening, roster, worker, gradle, workflow, page, client] = await Promise.all([
  readFile("supabase/migrations/20261123190000_server_receiver_native_companion.sql", "utf8"),
  readFile("supabase/functions/server-receiver/index.ts", "utf8"),
  readFile("apps/android-receiver/app/src/main/AndroidManifest.xml", "utf8"),
  readFile("apps/android-receiver/app/src/main/java/com/server/receiver/MainActivity.kt", "utf8"),
  readFile("apps/android-receiver/app/src/main/java/com/server/receiver/ServerWakeCallScreeningService.kt", "utf8"),
  readFile("apps/android-receiver/app/src/main/java/com/server/receiver/ServerReceiverRoster.kt", "utf8"),
  readFile("apps/android-receiver/app/src/main/java/com/server/receiver/ServerRosterRefreshWorker.kt", "utf8"),
  readFile("apps/android-receiver/app/build.gradle.kts", "utf8"),
  readFile(".github/workflows/server-receiver-companion-build.yml", "utf8"),
  readFile("web/receiver.html", "utf8"),
  readFile("web/receiver.js", "utf8")
]);

assert.match(migration, /server_receiver_native_pair_codes/);
assert.match(migration, /server_receiver_native_devices/);
assert.match(migration, /enable row level security/);
assert.match(edge, /action==="native_pair"/);
assert.match(edge, /action==="native_claim"/);
assert.match(edge, /action==="native_roster"/);
assert.match(edge, /action==="native_revoke"/);
assert.match(edge, /caller_hash/);
assert.match(edge, /receiver_secret_hash/);
assert.match(edge, /RECEIVER_NATIVE_REVOKE_SYNC_FAILED/);
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
assert.match(roster, /native_claim/);
assert.match(roster, /native_roster/);
assert.match(roster, /normalizeE164/);
assert.match(roster, /NET_CAPABILITY_VALIDATED/);
assert.match(worker, /ServerReceiverRoster\.sync/);
assert.match(gradle, /work-runtime-ktx/);
assert.match(workflow, /assembleDebug/);
assert.match(workflow, /apksigner" verify/);
assert.match(page, /offline-wake-companion/);
assert.match(client, /native_pair/);
assert.match(client, /serverreceiver:\/\/pair/);
console.log("PASS Server native Receiver contract — one-time pairing, keyed caller roster, Android call-screening service and APK build.");
