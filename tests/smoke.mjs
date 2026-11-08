import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const root = process.cwd();
const read = (p) => readFileSync(resolve(root,p),"utf8");
const migration=read("supabase/migrations/20261021114947_server_backend_schema.sql");
const pushMigration=read("supabase/migrations/20261101175446_server_push_devices_and_call_expiry.sql");
const schedulerMigration=read("supabase/migrations/20261021121000_server_maintenance_scheduler.sql");
const callExpiryMigration=read("supabase/migrations/20261105102434_server_call_expiry_reconciliation.sql");
const atomicCallMigration=read("supabase/migrations/20261105103540_server_atomic_call_creation.sql");
const queueExtensionMigration=read("supabase/migrations/20261105105014_server_durable_push_queue_extensions.sql");
const callDeliveryMigration=read("supabase/migrations/20261105105649_server_call_delivery_queue.sql");
const workerChainingMigration=read("supabase/migrations/20261105111000_server_call_delivery_worker_chaining.sql");
const dispatchTimeoutMigration=read("supabase/migrations/20261105113000_server_dispatch_timeout_and_noncollapse_push.sql");
const workerSlotsMigration=read("supabase/migrations/20261105115000_server_call_delivery_worker_slots.sql");
const workerAuditMigration=read("supabase/migrations/20261105120000_server_call_delivery_worker_audit.sql");
const presenceMigration=read("supabase/migrations/20261105124000_server_recipient_presence_and_reachability.sql");
const pushIdentityMigration=read("supabase/migrations/20261105125000_server_push_devices_custom_identity_fk.sql");
const offlineMissedCallMigration=read("supabase/migrations/20261105131000_server_offline_missed_call_inbox.sql");
const callStateTransitionMigration=read("supabase/migrations/20261108110000_server_atomic_call_state_transitions.sql");
const guestSingleClaimMigration=read("supabase/migrations/20261108152000_server_guest_single_claim.sql");
const activeRenegotiationMigration=read("supabase/migrations/20261108123000_server_atomic_transition_active_renegotiation.sql");
const keepAliveMigration=read("supabase/migrations/20261108142000_server_keepalive_probe.sql");
const signalRetentionMigration=read("supabase/migrations/20261108170000_server_call_signal_retention.sql");
const activeCallLeaseMigration=read("supabase/migrations/20261108180000_server_active_call_lease.sql");
const keepAliveWorkflow=read(".github/workflows/server-supabase-activity.yml");
const elfAlignmentScript=read("scripts/check-16kb-elf-alignment.py");
const android17InstallScript=read("scripts/android17-16kb-acceptance.sh");
const liveGuestTransitionContract=read("scripts/live-guest-transition-contract.mjs");
const offlineInbox=read("web/offline-inbox.js");
const guestServiceWorker=read("web/server-guest-sw.js");
const offlineArchitecture=read("docs/offline-delivery.md");
const callDeliveryWorker=read("supabase/functions/server-call-delivery-worker/index.ts");
const authMigration=read("supabase/migrations/20261021124332_server_custom_phone_auth.sql");
const handoffMigration=read("supabase/migrations/20261021195856_server_app_handoff.sql");
const deviceMigration=read("supabase/migrations/20261022100500_server_device_first_identity.sql");
const handoff=read("supabase/functions/server-handoff/index.ts");
const androidMain=read("apps/android-caller/app/src/main/java/com/server/caller/MainActivity.kt");
const androidSetup=read("apps/android-caller/app/src/main/java/com/server/caller/ServerSetupWebActivity.kt");
const androidFallbackSim=read("apps/android-caller/app/src/main/java/com/server/caller/ServerFallbackSimManager.kt");
const androidTelecom=read("apps/android-caller/app/src/main/java/com/server/caller/ServerConnectionService.kt");
const androidIdentityResolver=read("apps/android-caller/app/src/main/java/com/server/caller/ServerCallerIdentityResolver.kt");
const androidIncoming=read("apps/android-caller/app/src/main/java/com/server/caller/ServerIncomingCallService.kt");
const androidEngine=read("apps/android-caller/app/src/main/java/com/server/caller/ServerTelecomCallEngine.kt");
const androidPhoneNormalizer=read("apps/android-caller/app/src/main/java/com/server/caller/ServerPhoneNumberNormalizer.kt");
const androidGuestNotifications=read("apps/android-caller/app/src/main/java/com/server/caller/ServerGuestInviteNotifications.kt");
const androidGuestShare=read("apps/android-caller/app/src/main/java/com/server/caller/ServerGuestInviteShareActivity.kt");
const androidCarrierDialer=read("apps/android-caller/app/src/main/java/com/server/caller/ServerCarrierDialer.kt");
const androidCarrierActivity=read("apps/android-caller/app/src/main/java/com/server/caller/ServerCarrierDialActivity.kt");
const androidBuild=read("apps/android-caller/app/build.gradle.kts");
const androidCallNotifications=read("apps/android-caller/app/src/main/java/com/server/caller/ServerCallNotifications.kt");
const androidManifest=read("apps/android-caller/app/src/main/AndroidManifest.xml");
const androidTests=read("apps/android-caller/app/src/androidTest/java/com/server/caller/CallerSmokeTest.kt");
const androidSessionManager=read("apps/android-caller/app/src/main/java/com/server/caller/ServerDeviceSessionManager.kt");
const nativeWorkflow=read(".github/workflows/build-server-native.yml");
const guestBrowserE2eShell=read("scripts/android-guest-browser-e2e.sh");
const guestBrowserE2e=read("scripts/android-guest-browser-e2e.mjs");
const e2eIdentityScript=read("scripts/create-server-e2e-identity.mjs");
const androidVersionMatrix = nativeWorkflow.slice(nativeWorkflow.indexOf("  android-10-to-16-platform-matrix:"), nativeWorkflow.indexOf("  android-17-preview-compatibility:"));
const android17Preview = nativeWorkflow.slice(nativeWorkflow.indexOf("  android-17-preview-compatibility:"), nativeWorkflow.indexOf("  ios-simulator-build-and-preview:"));
const androidReaWorkflow=read(".github/workflows/server-rea-apk-audit.yml");
const androidEmulatorSmoke=read("scripts/android-emulator-smoke.sh");
const androidUnlock=read("scripts/unlock-android-emulator.sh");
const androidPackageManagerWait=read("scripts/wait-for-android-package-manager.sh");
const androidTestCountCheck=read("scripts/assert-android-test-count.py");
const android17Acceptance=read("scripts/android17-16kb-acceptance.sh");
const iosApp=read("apps/ios-caller/ServerCaller/ServerCallerApp.swift");
const iosInfo=read("apps/ios-caller/ServerCaller/Info.plist");
const iosEntitlements=read("apps/ios-caller/ServerCaller/ServerCaller.entitlements");
const iosProject=read("apps/ios-caller/ServerCaller.xcodeproj/project.pbxproj");
const iosModel=read("apps/ios-caller/ServerCaller/ServerViewModel.swift");
const iosView=read("apps/ios-caller/ServerCaller/ContentView.swift");
const auth=read("supabase/functions/server-auth/index.ts");
const androidIncomingAlert=read("apps/android-caller/app/src/main/java/com/server/caller/ServerIncomingCallAlertService.kt");
const androidFirebase=read("apps/android-caller/app/src/main/java/com/server/caller/ServerFirebaseMessagingService.kt");
const androidProguard=read("apps/android-caller/app/proguard-rules.pro");
const hook=read("supabase/functions/server-send-sms/index.ts");
const gateway=read("supabase/functions/server-gateway/index.ts");
const calls=read("supabase/functions/server-calls/index.ts");
const guest=read("supabase/functions/server-guest/index.ts");
const guestPreview=read("supabase/functions/server-guest-preview/index.ts");
const guestPreviewImage=read("web/images/server-incoming-call-preview.svg");
const gatewayOwnerMigration=read("supabase/migrations/20261106170000_server_gateway_owner_binding.sql");
const gatewayGuestClaimMigration=read("supabase/migrations/20261106170100_server_gateway_guest_owner_claim.sql");

const config=read("web/config.js");
const app=read("web/app.js");
const html=read("web/index.html");
const numberCallMigration=read("supabase/migrations/20261025180418_server_number_call_consent.sql");
const guestWeb=read("web/guest.js");
for (const table of ["server_profiles","server_gateway_devices","server_gateway_pairings","server_calls","server_call_members","server_guest_invites","server_call_signals","server_sms_jobs","server_rate_limits"]) {
 assert.match(migration,new RegExp("create table public\\."+table+"\\b"),"database schema includes "+table);
}
assert.match(migration,/enable row level security/i);
assert.match(migration,/server_claim_sms_jobs/);
for (const table of ["server_otp_challenges","server_sessions"]) assert.match(authMigration,new RegExp("create table if not exists public\\."+table+"\\b"));
assert.match(authMigration,/server_otp_pepper/);
assert.match(authMigration,/server_verify_otp/);
assert.match(handoffMigration,/server_app_handoffs/);
assert.match(deviceMigration,/server_device_identities/);
assert.match(deviceMigration,/server_id/);
assert.match(numberCallMigration,/allow_number_based_server_calls/);
assert.match(auth,/action==="register_device"/);
assert.match(auth,/action==="link_phone"/);
assert.match(auth,/PHONE_ALREADY_LINKED/);
assert.match(auth,/allow_number_based_server_calls/);
assert.match(auth,/async function bearer\(req:Request,db:any,allowExpiredForRefresh=false\)/,"expired sessions receive a grace window only through refresh");
assert.match(auth,/const expiryCutoff=allowExpiredForRefresh\?Date\.now\(\)-7\*24\*60\*60\*1000:Date\.now\(\)/,"expired-session cutoff is limited to seven days and is conditional");
assert.match(auth,/bearer\(req,db,action==="refresh"\)/,"normal API actions cannot use expired sessions");
assert.match(androidIncoming,/Server session recovery deferred/,"transient session-refresh and device-recovery failures must retry instead of stopping the incoming-call listener");
assert.match(androidIncoming,/Server session recovery rejected/,"permanent session-refresh and device-recovery failures are rejected");
assert.match(androidIncoming,/forceRefresh = true/,"incoming-call polling revalidates device sessions after an authoritative HTTP 401");
assert.match(calls,/found.allow_number_based_server_calls===true/);
assert.doesNotMatch(calls,/expireStaleRingingCalls|last_seen_at:\s*new Date\(\)\.toISOString\(\)/,
  "high-frequency call API requests must not run global expiry sweeps or write a session heartbeat");
assert.doesNotMatch(calls,/allSignals/,
  "call polling must calculate its cursor from the same signal query, not issue a duplicate database read");
assert.match(calls,/nextAfterSeq/,
  "call polling advances its signal cursor from the single ordered signal result");
assert.match(calls,/server_rate_limit_allow/,
  "call creation must be protected by a per-caller abuse limit");
assert.match(calls,/CALL_START_RATE_LIMITED/,
  "call creation returns an explicit rate-limit response instead of creating unlimited invitations");
assert.match(calls,/db\.rpc\("server_create_call_atomic"/,
  "call creation must commit the call, participants and guest invite through one database transaction");
assert.match(presenceMigration,/server_recipient_availability/,
  "recipient reachability is determined by a private database function");
assert.match(presenceMigration,/last_seen_at/,
  "recipient online status is based on a fresh session heartbeat rather than session expiry");
assert.match(pushIdentityMigration,/references public\.server_profiles\(user_id\)/,
  "push endpoints reference Server's custom profile identity rather than Supabase Auth users");
assert.doesNotMatch(pushIdentityMigration,/references auth\.users/,
  "push registration does not require a separate Supabase Auth identity");
assert.match(calls,/PRESENCE_WRITE_INTERVAL_MS = 12000/,
  "authenticated session presence writes are throttled to avoid a database write on every poll");
assert.match(calls,/touchSessionPresence\(db,session\)/,
  "the incoming-call listener refreshes its session presence while it is active");
assert.match(calls,/if\(action==="presence"\)/,
  "clients can explicitly refresh their own presence session");
assert.match(calls,/server_recipient_availability/,
  "the call start path checks recipient reachability before committing a Server call");
assert.match(calls,/RECIPIENT_OFFLINE/,
  "an offline Server recipient is reported before a phantom ringing call is created");
assert.match(calls,/missed_call_saved:true/,
  "the offline response confirms that a durable missed-call entry was saved without starting a live ring");
assert.match(calls,/carrier_fallback:\{status:carrierFallbackPhone\?"user_confirmed_dialer":"unavailable"/,
  "offline Server recipients receive a caller-confirmed SIM dialler option only when a number may be shared");
assert.match(calls,/method:"android_action_dial",requires_user_confirmation:true/,
  "the API describes a user-confirmed Android dialler handoff, not an automatic carrier call");
assert.match(calls,/status:"unknown_guest",connected:false,internet_status:"unknown"/,
  "a non-Server recipient is honestly marked unknown until its browser connects; mobile-data state is not guessed");
assert.match(calls,/recipient_availability:recipientAvailability/,
  "successful Server call creation returns the reachability classification to Android");
assert.match(calls,/return out\(\{[\s\S]*?ok:true,call_id:call\.id,route,call,ice_servers:callIceServers/,
  "the Server route returns the created call, ICE servers and call ID to the native caller");
assert.match(androidMain,/optString\("status"\)/,
  "Android distinguishes online recipients from background-reachable recipients");
assert.doesNotMatch(calls,/from\("server_call_members"\)\.upsert|from\("server_guest_invites"\)\.insert/,
  "call creation must not split participant or guest-invite writes across separate requests");
assert.match(atomicCallMigration,/create or replace function public\.server_create_call_atomic/,
  "the atomic database call-creation function exists in the migration");
assert.match(atomicCallMigration,/insert into public\.server_call_members/,
  "the atomic transaction creates its participant rows");
assert.match(atomicCallMigration,/insert into public\.server_guest_invites/,
  "the same atomic transaction creates guest invitation hashes");
assert.match(atomicCallMigration,/grant execute on function public\.server_create_call_atomic[\s\S]*?to service_role/,
  "only the service role may execute the internal atomic call-creation RPC");
assert.match(queueExtensionMigration,/create extension if not exists pgmq/,
  "durable Postgres-native message queue is enabled");
assert.match(queueExtensionMigration,/create extension if not exists pg_net/,
  "asynchronous internal HTTP dispatch is enabled");
assert.match(callDeliveryMigration,/pgmq\.send\(/,
  "Server call creation writes its wake-up event to the durable queue in the same transaction");
assert.match(callDeliveryMigration,/net\.http_post\(/,
  "the queue dispatcher wakes the private worker without blocking the caller");
assert.match(callDeliveryMigration,/server-call-delivery-recovery-every-minute/,
  "a scheduled recovery kick restarts processing after worker or deployment interruption");
assert.match(callDeliveryMigration,/server_validate_call_dispatch_secret/,
  "the internal notification worker is authenticated with a Vault-backed dispatch secret");
assert.match(callDeliveryWorker,/server_call_delivery_read_batch/,
  "the notification worker claims bounded queue batches");
assert.match(callDeliveryWorker,/VISIBILITY_SECONDS/,
  "queue messages are protected by a visibility lease while a worker processes them");
assert.match(callDeliveryWorker,/server_call_delivery_ack_batch/,
  "completed or expired notification jobs are acknowledged through the server-only queue API");
assert.match(callDeliveryWorker,/MAX_BATCH = 250/,
  "notification worker reads bounded batches rather than one row per HTTP invocation");
assert.match(callDeliveryWorker,/MAX_PARALLEL_SENDS = 40/,
  "notification provider fan-out is bounded within each worker invocation");
assert.match(callDeliveryWorker,/server_call_delivery_kick_continuation/,
  "worker chains the next batch when additional queue messages are visible");
assert.match(workerSlotsMigration,/server_call_delivery_worker_slots/,
  "the call delivery service has an explicit worker-slot lease table");
assert.match(workerSlotsMigration,/for update skip locked/,
  "worker slots are claimed exclusively without two dispatchers leasing the same slot");
assert.match(workerSlotsMigration,/server_call_delivery_claim_worker_slots\(8,90\)/,
  "the dispatcher enforces a fixed upper bound of eight concurrent workers");
assert.match(callDeliveryWorker,/server_call_delivery_worker_slot_valid/,
  "the worker validates its unique lease before reading the message queue");
assert.match(callDeliveryWorker,/server_call_delivery_release_worker_slot/,
  "each worker releases its slot in a finally block after batch completion");
assert.match(callDeliveryWorker,/WORKER_SLOT_LEASE_INVALID/,
  "requests without a valid worker lease cannot read the delivery queue");
assert.match(workerAuditMigration,/server_call_delivery_worker_runs/,
  "worker execution metrics are persisted in a server-only database table");
assert.match(callDeliveryWorker,/server_call_delivery_worker_runs/,
  "the worker creates and completes a durable execution record");
assert.match(callDeliveryWorker,/Number\(ackedResult\.data\) \|\| 0/,
  "worker acknowledgement metrics use the count confirmed by Postgres, not the intended batch size");
assert.match(workerChainingMigration,/server_call_delivery_kick_continuation/,
  "worker continuation endpoint is a server-only database function");
assert.match(callDeliveryWorker,/job\.read_ct >= MAX_READ_ATTEMPTS/,
  "missing endpoints and transient provider failures are retried with a finite attempt limit");
assert.doesNotMatch(callDeliveryWorker,/collapse_key/,
  "different call IDs must not collapse into one FCM wake notification");
assert.match(dispatchTimeoutMigration,/timeout_milliseconds:=10000/,
  "internal queue dispatch allows a cold worker up to ten seconds to respond");
assert.match(callDeliveryWorker,/call\.state !== "ringing"/,
  "the worker does not alert for calls already answered or otherwise no longer ringing");
assert.match(calls,/delivery_queued===true/,
  "the call API reports durable queue acceptance without claiming delivery");
assert.doesNotMatch(calls,/pushDelivery=await sendRecipientPush/,
  "the call API does not block call creation while synchronously contacting push providers");
assert.match(androidMain,/optBoolean\("queued", false\)/,
  "Android distinguishes queued delivery from provider acceptance or device delivery");
assert.match(calls,/CALL_CREATE_FAILED/,
  "call creation must fail closed when its atomic transaction cannot commit");
assert.match(schedulerMigration,/cron\.schedule\('server-maintenance-every-5-minutes'/,
  "expiry and maintenance work must be handled by the scheduled maintenance worker");
assert.match(callExpiryMigration,/server_calls_unanswered_expiry_idx/,
  "unanswered call expiry must be indexed outside the API request path");
assert.match(callExpiryMigration,/expires_at <= now\(\)/,
  "the maintenance worker must reconcile calls at their own configured expiry");
assert.match(callExpiryMigration,/cron\.schedule\('server-maintenance-every-minute'/,
  "call expiry is reconciled on a one-minute background schedule");
assert.match(signalRetentionMigration,/server_calls_terminal_signal_cleanup_idx/,
  "terminal calls have an index for bounded signalling-payload retention");
assert.match(signalRetentionMigration,/delete from public\.server_call_signals/i,
  "maintenance deletes transient call signalling separately from call history");
assert.match(signalRetentionMigration,/interval '10 minutes'/,
  "SDP and ICE signalling payloads are eligible for deletion ten minutes after a terminal call");
assert.match(signalRetentionMigration,/limit 25000/i,
  "signalling retention is bounded per maintenance run to control locks and WAL growth");
assert.match(signalRetentionMigration,/'signals_purged'/,
  "maintenance exposes the count of removed signalling rows for operational monitoring");
assert.match(signalRetentionMigration,/revoke all on function public\.server_maintenance\(\) from public, anon, authenticated/i,
  "the replaced maintenance routine remains unavailable to public client roles");
assert.match(calls,/state\.eq\.missed,expires_at\.gt\./,
  "incoming-call lookup must never ring a call after its expiry, even before the cron sweep runs");
assert.match(atomicCallMigration,/'id',v_call\.id[\s\S]*?'expires_at',v_call\.expires_at/,
  "atomic call creation returns only public call fields, not callee phone or private user IDs");
assert.match(calls,/\.select\("id,state,route,created_at,updated_at,expires_at"\)\.or\("caller_user_id\.eq\."\+uid/,
  "call polling responses expose only public call state and IDs");
assert.doesNotMatch(calls,/\.select\("[^"]*(?:callee_phone_e164|callee_user_id)[^"]*"\)\.or\(/,
  "call polling must not return private callee contact or identity fields");
assert.match(calls,/found\.allow_number_based_server_calls===true/);
assert.doesNotMatch(calls,/NUMBER_CALLING_DISABLED/,"unconsented numbers should use the guest-invite route, not fail at call setup");
assert.match(androidSetup,/requestPhoneLinkOtp/);
assert.match(androidSetup,/verifyAndLinkPhone/);
assert.match(app,/request-phone-link-code/);
assert.match(app,/onServerPhoneOtpRequested/);
assert.match(app,/onServerPhoneLinkResult/);
assert.match(app,/skip-phone-link/);
assert.match(app,/allow-number-calls/);
assert.match(androidSetup,/fun normalizePhoneNumber\(raw: String\): String/,"Android onboarding exposes its device-region phone normalizer to the website");
assert.match(androidSetup,/ServerPhoneNumberNormalizer\.deviceRegion/,"Android local-number parsing uses the actual device country context");
assert.match(app,/window\.ServerAndroid\.normalizePhoneNumber/,"Android web onboarding delegates national-number parsing to native metadata");
assert.ok(app.includes('if (!candidate.startsWith("+")) return null;'),"browser phone linking requires explicit international country-code input when native country metadata is unavailable");
assert.ok(app.includes(String.raw`return /^\+[1-9][0-9]{7,14}$/.test(candidate) ? candidate : null;`),"browser phone linking validates canonical E.164 numbers");
assert.ok(!app.includes('digits.startsWith("234")') && !app.includes('candidate = "+234"'),"browser phone linking has no Nigerian-only national-number fallback");
assert.ok(html.includes("+919876543210"),"website phone-link placeholder demonstrates a non-Nigerian international destination");

assert.match(app,/isAndroidWebView/);
assert.match(app,/isNativeSetup/);
assert.match(app,/userAgent\.toLowerCase\(\)\.includes\("; wv"\)/);
assert.match(app,/setNumberCallConsent/);
assert.match(html,/allow-number-calls/);
assert.match(auth,/LEGAL_ACCEPTANCE_REQUIRED/);
assert.doesNotMatch(androidMain,/READ_PHONE_NUMBERS|SubscriptionManager|selected_sim_/,
  "the Android call engine does not enumerate or depend on a selected SIM");
assert.doesNotMatch(androidSetup,/READ_PHONE_NUMBERS|SubscriptionManager|activeSubscriptionInfoList|TelephonyManager/,
  "the WebView bridge never reads SIM serials or phone numbers directly; SIM enumeration is isolated in the native selector");
assert.match(androidSetup,/ServerFallbackSimManager\.optionsJson/);
assert.match(androidSetup,/ServerFallbackSimManager\.saveSelection/);
assert.match(androidFallbackSim,/getSubscriptionId\(handle\)/);
assert.match(androidFallbackSim,/resolveActiveSubscriptionId/);
assert.doesNotMatch(androidFallbackSim,/getPhoneAccount\(handle\)/,
  "SIM fallback must not call the protected Telecom metadata API requiring READ_PHONE_NUMBERS");
assert.match(androidTests,/resolveActiveSubscriptionId\("opaque-account-id", activeSubscriptions, 30, 22\)/,
  "Android SIM fallback mapping is regression-tested without line-number permission");
assert.match(androidFallbackSim,/Manifest\.permission\.READ_PHONE_STATE/);
assert.doesNotMatch(androidFallbackSim,/getLine1Number|getSubscriberId|getIccSerialNumber|getSimSerialNumber|iccId\s*\(/i,
  "SIM fallback selection never invokes APIs that read subscriber phone numbers or serial identifiers");
assert.match(androidSetup,/registerDevice\(acceptedTerms: Boolean\)/,
  "Server ID registration is performed by the website's native permission bridge");
assert.match(androidSetup,/Manifest\.permission\.READ_PHONE_STATE/,
  "Android phone-state access is requested only for its Telecom system-account API");
assert.doesNotMatch(androidManifest,/android\.permission\.READ_PHONE_NUMBERS/,
  "Server must not request permission to read SIM phone numbers");
assert.doesNotMatch(androidTelecom,/selected_sim_phone/,
   "a legacy SIM number must not become Server's calling-account address");
assert.match(androidTelecom,/setAudioModeIsVoip\(true\)/,
   "Android Telecom is told that Server connections carry VoIP audio");
assert.match(androidCallNotifications,/Notification\.CallStyle\.forIncomingCall/,
  "Android 12+ incoming calls must use the native CallStyle template");
assert.match(androidCallNotifications,/NotificationManager\.IMPORTANCE_HIGH/,
  "incoming Server calls must use a high-importance notification channel");
assert.match(androidCallNotifications,/USAGE_NOTIFICATION_RINGTONE/,
  "incoming alerts must use ringtone audio usage");
assert.doesNotMatch(androidCallNotifications,/setBypassDnd\(true\)/,
  "Server must not bypass Do Not Disturb");
assert.match(androidCallNotifications,/ACTION_ANSWER/);
assert.match(androidCallNotifications,/ACTION_DECLINE/);
assert.match(androidCallNotifications,/ServerIncomingCallAlertService\.showIncomingCall/,
  "Android 12+ CallStyle must use its dedicated phone-call foreground service");
assert.match(androidCallNotifications,/ServerIncomingCallAlertService\.clearIncomingCall/,
  "ending a call must clear its dedicated alert notification");
assert.match(androidIncomingAlert,/buildIncomingNotification/,
  "the dedicated alert service must build the incoming CallStyle notification");
assert.match(androidIncomingAlert,/startForeground\(/,
  "the incoming CallStyle notification must be promoted by its own foreground service");
assert.match(androidIncomingAlert,/ACTION_SILENCE/);
assert.match(androidIncomingAlert,/ACTION_CLEAR/);
assert.match(androidIncoming,/startForeground\(FOREGROUND_NOTIFICATION_ID, notification/,
  "the background listener keeps its own low-importance foreground notification");

assert.match(androidTelecom,/ServerCallNotifications\.show/);
assert.match(androidTelecom,/answerFromNotification/);
assert.match(androidTelecom,/declineFromNotification/);
assert.match(androidManifest,/ServerCallActionReceiver/);
assert.match(androidCallNotifications,/CATEGORY_MISSED_CALL/);
assert.match(androidCallNotifications,/"Call back"/);
assert.match(androidCallNotifications,/buildMissedCallIntent/);
assert.match(androidIncoming,/ServerCallNotifications\.showMissed/);
assert.match(androidIncoming,/reportedMissedCallIds/);
assert.match(androidMain,/"missed_callback"/);
assert.match(calls,/\.in\("state",\["ringing","connecting","missed"\]\)/,
  "recent missed calls must be returned to Server after an offline recipient reconnects");
assert.match(calls,/\.gte\("updated_at",new Date\(Date\.now\(\)-14\*24\*60\*60\*1000\)\.toISOString\(\)\)/,
  "missed-call retrieval must be bounded to the recent two weeks");

assert.doesNotMatch(androidMain,/isSpeakerphoneOn\s*=/,
   "Server must not force speakerphone routing; Android and Telecom own the call audio route");
assert.match(androidMain,/endCall\(intent\.getStringExtra\("server_call_id"\)\)/,
   "system hang-up events must carry their Telecom call ID through to the backend call teardown");
assert.match(androidEmulatorSmoke,/CALLER_DEBUG_APK="apps\/android-caller\/app\/build\/outputs\/apk\/debug\/app-universal-debug\.apk"/,
  "Android smoke must use the actual ABI-split universal debug APK output");
assert.ok(nativeWorkflow.includes("apps/android-caller/app/build/outputs/apk/debug/*.apk"),
  "all ABI-specific caller debug APKs must be included in uploaded diagnostics");
assert.ok(nativeWorkflow.includes("find_debug_apk_for_abi()"),
  "physical and emulator APKs are located by their WebRTC ABI instead of a fixed Gradle filename");
assert.ok(nativeWorkflow.includes("find_debug_apk_for_abi arm64-v8a"),
  "the physical-device package selector explicitly requires the ARM64 WebRTC library");
assert.ok(nativeWorkflow.includes("find_debug_apk_for_abi x86_64"),
  "the emulator package selector explicitly requires the x86_64 WebRTC library");
assert.match(androidEmulatorSmoke,/cp "\$CALLER_DEBUG_APK" artifacts\/server-caller-debug-for-reinstall\.apk/,"caller APK is preserved outside Gradle build outputs before instrumentation");
assert.match(androidEmulatorSmoke,/adb install -r artifacts\/server-caller-debug-for-reinstall\.apk/,"post-test UI smoke reinstalls the preserved caller APK");
assert.ok(androidEmulatorSmoke.indexOf("CALLER_APK_BACKUP_READY") < androidEmulatorSmoke.indexOf("connectedDebugAndroidTest"),"caller APK backup must happen before instrumentation cleanup");
assert.match(androidTests,/telecomHangupUsesCallIdFromSystemIntentWhenActivityHasNoCallState/,
   "system hang-up after activity recreation has an Android instrumentation regression test");
assert.match(androidManifest,/android\.permission\.ACCESS_NETWORK_STATE/,
   "the native call engine can distinguish a real internet connection from a disconnected device");
assert.match(androidMain,/isServerInternetUsable\(networkCapabilities\)/,
   "outgoing Server calls check for an internet-capable network before signalling");
assert.match(androidMain,/return hasInternetCapability/,
   "Android captive-portal validation must not falsely reject usable mobile-data networks");
assert.match(androidMain,/pendingSystemDialerReturn/,
   "system Phone UI handoff must wait for the actual outgoing-call setup result");
assert.match(androidMain,/guestShareLauncher\.launch\(chooser\)/,
   "guest invitations from a system dialer call must open the share chooser while Server is foregrounded");
assert.match(androidMain,/recordTelecomDebugStage\("backend_start_requested"\)/,
   "the outgoing Telecom regression records that a real backend call request was attempted");
assert.match(androidMain,/recordTelecomDebugStage\("call_setup_failed"\)/,
   "the outgoing Telecom regression records call setup failure rather than silently hiding it");
assert.match(androidMain,/handoffToCarrierDialer\(normalizedPhone, null\)/,
   "when the caller has no internet, a known phone destination is handed to the selected SIM");
assert.match(androidTests,/phoneAccountCanReceiveIncomingCallThroughTelecom/);
assert.match(androidTests,/preinstalledPhoneDialerOffersServerAsAnOutgoingCallChoice/);
assert.match(androidTests,/debug_telecom_connection_engine_started/);
assert.match(androidTelecom,/ServerTelecomCallEngine\(this, connection\)/,
  "outgoing calls are processed by the Android Telecom-bound WebRTC engine");
assert.match(androidTelecom,/engine\.startOutgoing\(phone\)/,
  "the system Phone provider starts signalling without launching the Server Activity");
assert.doesNotMatch(androidTelecom,/ServerTelecomRegistry\.openApp\(this/,
  "outgoing and incoming Telecom call creation must not start a background Activity");
assert.match(androidTelecom,/callEngine\?\.answerIncoming\(id\)/,
  "incoming calls are answered by the Telecom-bound WebRTC engine");
assert.match(androidTelecom,/callEngine\?\.hangup\(\)/,
  "system disconnect events are handled by the Telecom-bound WebRTC engine");
assert.match(androidReaWorkflow,/com\.server\.caller\.ServerTelecomCallEngine/,
  "compiled APK inspection must target the Telecom-bound WebRTC engine used by Android Phone");
assert.match(androidReaWorkflow,/ServerConnectionService onCreateOutgoingConnection/,
  "compiled APK inspection must trace the outgoing Telecom callback into the call engine");
assert.match(androidBuild,/create\("serverPreview"\)/,
  "preview releases support a persistent private Android signing key");
assert.match(nativeWorkflow,/SERVER_ANDROID_KEYSTORE_BASE64/,
  "release CI imports the persistent preview signing key from a GitHub Actions secret");
assert.match(nativeWorkflow,/preview_signing_ready/,
  "the website release asset is published only after stable signing is configured");
assert.match(androidReaWorkflow,/ServerGuestInviteNotifications show/,
  "compiled APK audit must inspect the actual notification that hands an invitation to the caller for sharing");
assert.match(androidReaWorkflow,/ServerGuestInviteShareActivity onCreate/,
  "compiled APK audit must inspect the native share chooser handoff for non-Server recipients");
assert.match(androidReaWorkflow,/ServerTelecomCallEngine onIceConnectionChange/,
  "compiled APK inspection must verify the call engine's real ICE-connected state handling");
assert.doesNotMatch(androidReaWorkflow,/MainActivity startCall|MainActivity preparePeer|MainActivity handleSignal/,
  "the call-engine audit must not use the obsolete Activity WebRTC implementation");
assert.match(androidTests,/enablePhoneAccountWithTestShell/);
assert.match(nativeWorkflow,/api-level: 26/, "Android 8 remains a minimum-install compatibility check");
assert.ok(nativeWorkflow.includes("script: bash scripts/android-guest-browser-e2e.sh"),
  "guest E2E runs a checked-in Bash script as one command instead of passing multi-line Bash through sh");
assert.match(e2eIdentityScript,/action: "availability"/,
  "the real Server E2E identity exercises the deployed authenticated availability preflight");
assert.match(e2eIdentityScript,/status !== "unknown_guest"/,
  "a first-time non-Server recipient is reported as unknown, not falsely as mobile data off");
assert.match(e2eIdentityScript,/requires_user_confirmation !== true/,
  "availability preflight exposes caller-confirmed SIM fallback without placing a carrier call");
assert.match(guestBrowserE2eShell,/adb shell am instrument -w -r/,
  "the Bash E2E harness launches the real Android Telecom instrumentation test");
assert.match(guestBrowserE2eShell,/node scripts\/android-guest-browser-e2e\.mjs/,
  "the Bash E2E harness drives the no-install guest through Playwright");
assert.doesNotMatch(nativeWorkflow,/bash -euo pipefail <<'BASH'/,
  "the emulator action must not split an inline Bash here-document into individual sh commands");
assert.ok(android17Preview.includes("api-level: '37.0'"), "Android 17 preview job uses the SDK platform 37.0 package identifier");
assert.ok(android17Preview.includes("system-image-api-level: '37.0'"), "Android 17 preview job uses the 37.0 emulator image namespace");
assert.ok(android17Preview.includes("target: google_apis_ps16k"), "Android 17 preview job uses the supported 16 KB-page Google APIs image");
assert.match(nativeWorkflow,/api-level:\s*\[29,\s*30,\s*31,\s*32,\s*33,\s*34,\s*35,\s*36\]/, "Android 10 through Android 16, including Android 12L API 32 and Android 16 API 36, are the stable release matrix");
assert.ok(nativeWorkflow.includes("scripts/wait-for-android-package-manager.sh"), "every Android emulator test waits for Package Manager before installing the app");
const androidBuildJob = nativeWorkflow.slice(nativeWorkflow.indexOf("  android-build-and-emulator-smoke:"),nativeWorkflow.indexOf("  android-guest-browser-e2e:"));
const androidGuestJob = nativeWorkflow.slice(nativeWorkflow.indexOf("  android-guest-browser-e2e:"),nativeWorkflow.indexOf("  android-8-minimum-install-smoke:"));
const androidMinimumJob = nativeWorkflow.slice(nativeWorkflow.indexOf("  android-8-minimum-install-smoke:"),nativeWorkflow.indexOf("  android-10-to-16-platform-matrix:"));
assert.ok(androidBuildJob.includes("runs-on: ubuntu-24.04") &&
  androidGuestJob.includes("runs-on: ubuntu-24.04") &&
  androidMinimumJob.includes("runs-on: ubuntu-24.04") &&
  androidVersionMatrix.includes("runs-on: ubuntu-24.04"),
  "stable Android emulator, guest-audio, minimum-install and API-matrix jobs use Linux KVM rather than the macOS emulator runners that repeatedly timed out offline");
assert.ok(androidBuildJob.includes("sudo apt-get install -y coreutils binutils") &&
  androidBuildJob.includes("command -v readelf"),
  "the Linux build job installs a readelf implementation accepted by the APK ELF-alignment audit");
for (const job of [androidBuildJob, androidGuestJob, androidMinimumJob, androidVersionMatrix]) {
  assert.ok(job.includes("Enable Linux KVM access for Android emulator") &&
    job.includes("sudo chmod 666 /dev/kvm"),
    "each stable Android emulator job explicitly verifies and enables hardware KVM access");
}
assert.ok(androidGuestJob.includes("pulseaudio --start") &&
  guestBrowserE2e.includes("--use-file-for-fake-audio-capture"),
  "the Android-to-browser audio E2E uses a Linux virtual-audio host and deterministic microphone input");
assert.ok(android17Preview.includes("runs-on: macos-15") &&
  android17Preview.includes("continue-on-error: true"),
  "Android 17 remains an explicitly non-blocking Apple Silicon preview while stable APIs gate release");
assert.doesNotMatch(nativeWorkflow,/if: github\.head_ref != 'android-finish' && github\.ref != 'refs\/heads\/android-finish'/,
  "the Android completion branch also runs the iOS simulator build and startup check");
assert.ok(androidVersionMatrix.includes("channel: stable"), "stable Android 10–16 matrix uses released SDK images");
assert.ok(androidVersionMatrix.includes("disk-size: 8G"), "stable Android emulator jobs use an 8 GB userdata partition for system and test app headroom");
assert.ok(!nativeWorkflow.includes("android-16-stable-compatibility-smoke"), "Android 16 is tested once in the unified version matrix");
assert.ok(androidTests.includes("Manifest.permission.READ_CONTACTS"), "the Telecom instrumentation test grants Contacts access before testing national-format dialer destinations");
assert.ok(androidPhoneNormalizer.includes('private val E164 = Regex("^\\\\+[1-9][0-9]{1,14}$")'), "global E.164 parsing accepts short valid international numbers after libphonenumber validates them");
assert.match(androidTests,/preinstalledPhoneDialerOffersServerAsAnOutgoingCallChoice/, "system Phone chooser test uses explicit E.164 destination to isolate Telecom integration");
assert.match(androidTests,/serverCallUsesInternetCapabilityWithoutCarrierValidationFalseNegatives/,
   "mobile-data connectivity gating has an Android instrumentation test that ignores captive-portal validation false negatives");
assert.match(androidTests,/Outgoing Telecom flow must wait for the Server backend result/,
   "the preinstalled Phone-app test verifies outgoing calls are not backgrounded before backend success or failure");
assert.match(androidTests,/launcherShowsHybridOnboardingWithFallbackSimChoice/);
assert.ok(androidVersionMatrix.includes("-Pandroid.testInstrumentationRunnerArguments.class=com.server.caller.CallerSmokeTest"), "every stable Android 10–16 API runs the complete instrumentation class, including onboarding and Telecom acceptance");
assert.ok(androidVersionMatrix.includes("assert-android-test-count.py --expected-tests 17"), "every stable Android 10–16 API must execute all 17 acceptance tests without skipped or failed tests");
assert.ok(android17Preview.includes("scripts/android17-16kb-acceptance.sh") && android17Preview.includes("assert-android-test-count.py --expected-tests 17"), "Android 17 remains separately tested with the full 17-test 16 KB acceptance suite");
assert.ok(android17Preview.includes("ram-size: 4096M") && android17Preview.includes("emulator-boot-timeout: 600") && android17Preview.includes("timeout-minutes: 50") && android17Preview.includes("disk-size: 8G"), "Android 17 ARM64 preview receives the appropriate 4 GB guest RAM, 8 GB storage and 10-minute boot budget on the 7 GB Apple Silicon runner");
assert.ok(!nativeWorkflow.slice(nativeWorkflow.indexOf("  publish-android-preview-release:")).includes("android-17-preview-compatibility"), "an unstable Android 17 preview emulator does not block publication after the stable Android release matrix passes");
assert.match(android17Acceptance,/getconf PAGE_SIZE/);
assert.match(android17Acceptance,/16384/);
assert.match(android17Acceptance,/zipalign" -c -P 16/);
assert.match(android17Acceptance,/adb install -r/);
assert.match(androidMain,/result\.optJSONObject\("user"\) \?: result\.optJSONObject\("profile"\)/);
assert.match(iosModel,/func registerDevice\(\) async/);
assert.match(iosModel,/ServerVoIPPushRegistry/);
assert.match(iosModel,/didReceiveIncomingPushWith/);
assert.match(iosModel,/register_push_token/);
assert.match(iosEntitlements,/<key>aps-environment<\/key>/);
assert.match(iosModel,/func requestPhoneLinkCode\(\) async/);
assert.match(iosModel,/func verifyAndLinkPhone\(\) async/);
assert.match(iosModel,/PHONE_ALREADY_LINKED/);
assert.match(iosView,/Create Server identity/);
assert.match(iosView,/onContinueUserActivity/);
assert.match(iosView,/model.requestPhoneLinkCode\(\)/);
assert.match(iosView,/model.verifyAndLinkPhone\(\)/);
assert.match(iosView,/Allow Server calls on this number/);
assert.match(iosModel,/set_number_call_consent/);
assert.match(iosModel,/loadNumberCallPreferences/);
assert.match(iosModel,/private func handleCallKitEnd\(_ uuid: UUID\) async/,"CallKit reject/end actions resolve incoming calls as well as active calls");
assert.match(iosModel,/func reportEnded\(id: String, reason: CXCallEndedReason\)/,"remote and failed call outcomes are reported to CallKit");
assert.match(iosModel,/private func reconcilePendingIncoming\(_ pending: IncomingCall, rows: \[\[String: Any\]\]\) async/,"stale or answered-elsewhere incoming calls are cleared from CallKit");
assert.match(iosModel,/api\("signal", body: \["call_id": incoming\.id, "kind": "hangup"/,"declining a ringing call signals the backend");
assert.match(iosModel,/callKit\.reportEnded\(id: id, reason: \.remoteEnded\)/,"remote hangup clears the system call UI");
assert.match(iosView,/model.linkedPhone/);
assert.match(iosView,/INStartAudioCallIntent/);
assert.match(iosInfo,/NSUserActivityTypes/);
assert.match(iosView,/telephony/);
assert.match(iosEntitlements,/com.apple.developer.calling-app/);
assert.match(iosInfo,/<string>voip<\/string>/);
assert.match(iosProject,/CODE_SIGN_ENTITLEMENTS = ServerCaller\/ServerCaller.entitlements/);
assert.doesNotMatch(iosView,/CNContactStore/);











assert.match(iosModel,/to_server_id/);
assert.match(handoff,/HANDOFF_EXPIRED_OR_ALREADY_USED/);
assert.match(handoff,/server_sessions/);
assert.match(app,/server:\/\/device-setup/);
assert.match(androidMain,/handleAppLink/);
assert.match(androidManifest,/android:scheme="server"/);
assert.match(androidManifest,/android:name="com.server.caller.ServerSetupWebActivity"/);
assert.match(androidManifest,/android:name="com.server.caller.ServerIncomingCallService"/);
assert.match(androidManifest,/android:name="com.server.caller.ServerIncomingCallAlertService"/);
assert.match(androidManifest,/com.server.caller.ServerFirebaseMessagingService/);
assert.match(androidBuild,/isMinifyEnabled = true/);
assert.match(androidBuild,/isShrinkResources = true/);
assert.match(androidBuild,/compileSdk = 36/);
assert.match(androidBuild,/targetSdk = 36/);
assert.match(androidBuild,/isEnable = releaseAbiSplits/);
assert.match(androidBuild,/SERVER_ENABLE_RELEASE_ABI_SPLITS/);
assert.match(androidBuild,/defaultConfig\s*\{[\s\S]*?ndk\s*\{\s*abiFilters\.clear\(\)\s*abiFilters\.addAll\(serverDebugAbiFilters\)/,
  "the selected debug ABI is applied at defaultConfig so prebuilt WebRTC AAR native libraries are packaged");
assert.match(androidBuild,/release\s*\{[\s\S]*?abiFilters\.clear\(\)\s*abiFilters\.addAll\(listOf\("armeabi-v7a", "arm64-v8a"\)\)/,
  "release APKs retain ARM64 and ARMv7 phone ABIs even when the CI debug build targets x86_64");
assert.match(androidBuild,/isUniversalApk = true/);
assert.match(nativeWorkflow,/bundleRelease -PSERVER_ENABLE_RELEASE_ABI_SPLITS=false/);
assert.match(nativeWorkflow,/assembleRelease -PSERVER_ENABLE_RELEASE_ABI_SPLITS=true/);
assert.match(read("apps/android-caller/build.gradle.kts"),/version "8\.9\.1"/);
assert.doesNotMatch(read("web/app.js"),/\?\./);
assert.match(androidBuild,/androidx\.fragment:fragment-ktx:1\.9\.1/);
assert.match(androidBuild,/versionCode = 2/);
assert.match(androidBuild,/versionName = "0.2.0"/);
assert.ok(nativeWorkflow.includes("app-arm64-v8a-release.apk"));
assert.ok(nativeWorkflow.includes("app-armeabi-v7a-release.apk"));
assert.ok(nativeWorkflow.includes("ANDROID_ARM_PHONE_RELEASE_ASSETS_PUBLISHED"));
assert.match(androidProguard,/-keep class org\.webrtc/);
assert.match(androidFirebase,/onMessageReceived/);
assert.match(androidFirebase,/server_incoming_call/);
assert.match(androidFirebase,/ServerIncomingCallService.start\(this\)/);
assert.match(calls,/action==="register_push_token"/);
assert.ok(calls.includes("SERVER_CALL_TTL_SECONDS = 180"));
assert.ok(calls.includes("GUEST_CALL_TTL_SECONDS = 20 * 60"));
assert.ok(calls.includes('route==="guest"?GUEST_CALL_TTL_SECONDS:SERVER_CALL_TTL_SECONDS'));
assert.ok(guest.includes('["ringing","connecting"].includes(call.state)&&call.expires_at'));
assert.doesNotMatch(androidMain,/callStartedAt|carrierFallbackOfferedFor|carrierFallbackPhone/);
assert.match(calls,/APNS_TEAM_ID/);
assert.match(calls,/apns-push-type/);
assert.match(pushMigration,/create table if not exists public.server_push_devices/);
assert.match(pushMigration,/add column if not exists expires_at/);
assert.match(androidManifest,/android\.permission\.CALL_PHONE/,
  "automatic carrier fallback declares the Android permission but requests it only after explicit opt-in");
assert.match(androidSetup,/REQUEST_AUTO_CARRIER_FALLBACK/,
  "Android requests carrier-call permission separately after the user enables automatic fallback");
assert.match(androidFallbackSim,/automaticFallbackEnabled\(context\)/,
  "automatic carrier calls require saved consent, CALL_PHONE and a still-active selected SIM");

assert.match(androidSetup,/getNumberCallPreferences/);
assert.match(androidSetup,/onPageFinished/);
assert.ok(androidSetup.includes('page = page.replace("</body>", inlineScript + "\\n</body>")'));
assert.doesNotMatch(androidSetup,/target\.evaluateJavascript\(bundledJavaScript\)/);
assert.match(androidSetup,/onPageFinished/);
assert.match(androidSetup,/Register before opening system settings/);
assert.match(androidSetup,/server-native-bridge/);
assert.match(androidSetup,/set_number_call_consent/);
assert.match(androidSetup,/createSmsGatewayPairingCode/,"native bridge issues gateway pairing codes from the authenticated Server session");
assert.match(androidSetup,/server-gateway/,"gateway pairing calls the dedicated backend function");
assert.match(app,/create-sms-gateway-pairing-code/,"onboarding website exposes the pairing flow");
assert.match(app,/onServerGatewayPairingCode/,"website handles pairing-code results");
assert.match(html,/sms-gateway-pairing-code/,"onboarding UI can display the one-time gateway code");
assert.doesNotMatch(androidManifest,/DialerActivity/);
assert.match(androidManifest,/android:name="android.intent.action.MAIN"/);
assert.doesNotMatch(androidSetup,/SubscriptionManager|activeSubscriptionInfoList|selectSim/,
  "Android setup must not inspect or select a SIM subscription");
assert.match(androidSetup,/requestCallPermissions/);
assert.match(androidSetup,/READ_PHONE_STATE/);
assert.match(androidTelecom,/PhoneAccount.CAPABILITY_CALL_PROVIDER/);
assert.match(androidEngine,/connection\.setRingbackRequested\(route == "server"\)/,
  "Telecom ringback is requested only for a real Server recipient, never for a manual guest share");
assert.match(androidEngine,/toStartPayload\("android_telecom"\)/,
  "system Phone calls use the explicit native source payload when creating a backend call");
assert.match(androidEngine,/two_way_audio_media_ready/);
assert.match(androidEngine,/remote_audio_track_received/);
assert.match(androidEngine,/audio_rtp_packets_both_directions/);
assert.match(androidEngine,/outboundAudioRtpPacketsSent/);
assert.match(androidEngine,/inboundAudioRtpEnergy/);
assert.match(androidEngine,/outboundAudioRtpEnergy/);
assert.match(androidEngine,/RTCStatsCollectorCallback/);
assert.match(guestWeb,/inbound-rtp/);
assert.match(androidTests,/Caller received no inbound audio RTP packets/);
assert.match(androidTests,/Recipient received no inbound audio RTP packets/);
assert.match(androidTests,/server-guest-preview\[\?\]token=/,"native Android guest E2E checks the caller-preview link rather than the old direct guest-page URL");
assert.match(androidTests,/webRtcPeersExchangeAudioTracksAndConnectOnAndroidDevice/,
  "Android instrumentation negotiates two WebRTC peers, exchanges audio tracks and reaches ICE CONNECTED");
assert.match(androidMain,/if \(pendingSystemDialerReturn\) payload\.put\("source", "android_telecom"\)/,
  "the legacy Android Phone intent bridge must use the same backend no-guest route guard");
assert.match(androidEngine,/ServerGuestInviteNotifications\.show\(context, callId\.orEmpty\(\), target\.phoneNumber\.orEmpty\(\), invitation\)/,
  "a non-Server contact receives an explicit notification to share the expiring browser invitation");
assert.match(androidGuestNotifications,/NotificationCompat\.Action|addAction/,
  "the no-install route uses a native notification action rather than opening a caller webpage");
assert.match(androidGuestShare,/Intent\(Intent\.ACTION_SEND\)/,
  "the caller explicitly opens Android's native share chooser");
assert.match(androidMain,/Intent\.createChooser\(share, "Share Server invitation to "/,
  "MainActivity uses Android's general Sharesheet for guest-call links");
assert.doesNotMatch(androidMain,/Intent\(Intent\.ACTION_SENDTO|smsto:|putExtra\("sms_body"|EXTRA_INITIAL_INTENTS/,
  "Server does not promote or pre-address SMS as a guest-call invitation action");
assert.doesNotMatch(androidGuestShare,/Intent\(Intent\.ACTION_SENDTO|smsto/,
  "Server uses the generic share chooser and does not force an addressed SMS invitation");
assert.doesNotMatch(androidGuestShare,/sendTextMessage|SmsManager\.send/,"the caller app delegates SMS transmission to the paired SIM gateway, not its own process");
assert.match(androidManifest,/android:name="com\.server\.caller\.ServerGuestInviteShareActivity"/,
  "the native share activity is available only after the user taps the guest invitation notification");
assert.match(androidPhoneNormalizer,/PhoneNumberUtil\.getInstance\(\)/,
  "all supported Android releases use the same bundled international numbering metadata");
assert.match(androidPhoneNormalizer,/phoneUtil\.parse\(value, defaultRegion \?: "ZZ"\)/,
  "national-format contact numbers are parsed with an explicit destination-region context");
assert.match(androidPhoneNormalizer,/PhoneLookup\.CONTENT_FILTER_URI/,
  "Android looks up only the selected saved-contact number before interpreting a national number");
assert.match(androidPhoneNormalizer,/PhoneLookup\.NORMALIZED_NUMBER/,
  "Android inspects the contact provider's number but does not blindly trust provider inference");
assert.match(androidPhoneNormalizer,/savedNumber\.trim\(\)\.startsWith\("\+"\)/,
  "only an explicitly + prefixed saved contact number is independently trusted");
assert.match(androidPhoneNormalizer,/normalizedRegion == contactRegion/,
  "provider-inferred E.164 must agree with the contact country before it is trusted");
assert.match(androidPhoneNormalizer,/ContactHints\(ambiguous = true\)/,
  "national-format numbers fail closed when contact lookup is unavailable");
assert.match(androidPhoneNormalizer,/StructuredPostal\.COUNTRY/,
  "contact country is compared with provider-normalized E.164 before that inferred value is trusted");
assert.match(androidPhoneNormalizer,/toE164WithContactMetadata/,
  "the contact's destination country takes precedence over the caller's SIM region");
assert.match(androidPhoneNormalizer,/phoneUtil\.format\(parsed, PhoneNumberUtil\.PhoneNumberFormat\.E164\)/,
  "explicit international contacts retain their destination country code in E.164 form");
assert.match(androidPhoneNormalizer,/simCountryIso/);
assert.match(androidPhoneNormalizer,/networkCountryIso/);
assert.match(androidPhoneNormalizer,/Locale\.getDefault\(\)\.country/,
  "the default phone region is resolved from SIM, then network, then device locale");
assert.match(androidEngine,/ServerPhoneNumberNormalizer\.toE164FromDevice\(context, raw\)/,
  "Telecom resolves the destination from contact metadata before caller-region fallback");
assert.match(androidMain,/ServerPhoneNumberNormalizer\.toE164FromDevice\(this, raw\)/,
  "the legacy Android route shares the same contact-first country resolver as Telecom");
assert.match(androidTests,/internationalNumberingMetadataCoversEverySupportedRegion/,
  "worldwide numbering metadata is exercised on the Android test matrix");
assert.match(androidTests,/destinationCountryFromSavedContactMetadataBeatsCallerRegion/,
  "a saved contact country must override the caller SIM country");
assert.match(androidSetup,/Manifest\.permission\.READ_CONTACTS/,
  "Android requests permission to resolve saved-contact destination country locally");
assert.match(androidManifest,/android\.permission\.READ_CONTACTS/);
assert.match(app,/destinationCountryContactsGranted/,
  "the onboarding UI explains that contact country lookup is optional and stays on-device");
assert.match(androidSetup,/ServerPushRegistration\.syncFcmToken\(this\)/,
  "first-time website onboarding registers the FCM token after a Server session is saved");
assert.doesNotMatch(calls,/b\.source==="android_telecom"&&route!=="server"/,
  "a system Phone call may use the secure guest browser route when the recipient does not have Server");
assert.match(calls,/delivery_mode:"manual_share"/,
  "guest invitations are deliberately shared by the caller rather than automatically sent by SMS");
assert.doesNotMatch(calls,/from\("server_sms_jobs"\)\.insert/,
  "new guest calls never enqueue per-call SMS invitations");
assert.match(androidTelecom,/override fun onDisconnect\(\) \{\s*setRingbackRequested\(false\)/,
  "system disconnect must stop any active Telecom ringback");
assert.match(androidTests,/preinstalledPhoneDialerOffersServerAsAnOutgoingCallChoice/);
assert.match(androidTests,/Intent\(Intent\.ACTION_DIAL\)/,
  "outgoing-call acceptance opens Android's real Phone dialer");
assert.match(androidTests,/By\.res\(resolvedDialerPackage, "digits"\)/,
  "the test locates the Phone dialer's destination EditText");
assert.match(androidTests,/digitsField!!\.setText\(dialledNumber\)/,
  "the test enters an explicit E.164 destination into the real dialer EditText without keycode assumptions");
assert.match(androidTests,/displayedDestinationDigits/,
  "dialer acceptance tolerates visual grouping while checking every E.164 digit");
assert.match(androidTests,/debug_last_telecom_request_target_length/,
  "outgoing-call acceptance verifies the full E.164 target reaches Android Telecom");
assert.doesNotMatch(androidTests,/Hiding the keyboard must leave the entered destination in the dialpad|device\.pressBack\(\).*dialpad/,
  "the Phone picker must not press Back and accidentally close Android's dialpad");
assert.match(androidTests,/input_method_nav_back/,
  "the Phone picker uses the system IME navigation control rather than Android Phone Back");
assert.match(androidTests,/guestCallInvitationNotificationOffersShareAndSelectedSimActions/,
  "the no-install guest route has an executable native notification/share and SIM-fallback test");
assert.match(androidTests,/Call using selected SIM/,
  "the guest notification instrumentation test verifies the selected SIM fallback action is visible");
assert.match(androidTests,/Intent\.ACTION_DIAL/,
  "the guest notification instrumentation test verifies the fallback opens the system dialler");
assert.match(androidTests,/createShareChooserIntent/,
  "the guest share chooser is unit-testable without sending a text");
assert.match(androidTests,/enablePhoneAccountWithTestShell\(context, serverHandle\)/,
  "Telecom test setup enables the account without depending on OEM-specific Settings layouts");
assert.match(androidTests,/telecom\.defaultDialerPackage/,
  "the Phone-picker test resolves the installed default dialer instead of assuming a package name");
assert.match(html,/Ask every time/,
  "website explains the Android outgoing-account preference needed by some dialers");
assert.match(html,/id="download-android-connector"/,
  "public website provides a direct Android connector installation action");
assert.ok(html.includes("releases/download/server-android-connector-preview/server-android-arm64.apk"), "the primary onboarding download is the ARM64 phone build");
assert.ok(html.includes("releases/download/server-android-connector-preview/server-android-armv7.apk"), "onboarding offers the separate ARMv7 phone build");
assert.match(html,/emulator-only x86 packages are not offered here/);
assert.match(html,/I'?ve installed Server — continue setup/,
  "website offers the return-to-this-page hand-off after connector installation");
assert.match(app,/androidDownload && androidDownload\.addEventListener/,
  "website explains that the user should return after the APK download");
assert.ok(app.includes("androidDownloadArmv7 && androidDownloadArmv7.addEventListener"));

assert.match(androidTelecom,/reconcileIncoming\(liveCallIds: Set<String>\)/,"incoming Telecom calls are reconciled against backend ringing state");
assert.match(androidIncoming,/ServerTelecomRegistry.reconcileIncoming\(liveCallIds\)/,"the background listener clears unanswered calls that disappear from the backend");
assert.match(androidTelecom,/PhoneAccount.SCHEME_TEL/);
assert.doesNotMatch(androidTelecom,/PhoneAccount.CAPABILITY_SIM_SUBSCRIPTION/);
assert.match(androidFallbackSim,/getSubscriptionId\(handle\)/,
  "SIM-backed fallback uses Android's subscription mapping API rather than requesting line-number permission");
assert.match(iosView,/model.handleAppHandoff/);
assert.match(iosView,/Set up Server on this iPhone/);
assert.match(iosView,/How iPhone calling works/);
assert.match(iosInfo,/CFBundleURLTypes/);
assert.match(auth,/action==="request_otp"/);
assert.match(auth,/action==="verify_otp"/);
assert.match(auth,/server_issue_otp/);
assert.match(auth,/server_verify_otp/);
assert.match(auth,/access_token/);
assert.match(auth,/SESSION_REQUIRED/);
assert.match(hook,/new Webhook\(secret\)\.verify/);
assert.match(hook,/SMS_HOOK_NOT_CONFIGURED/);
assert.match(hook,/SMS_GATEWAY_OFFLINE/);
assert.doesNotMatch(hook,/console\.(log|error)\([^)]*otp/i);
assert.match(gateway,/create_pairing_code/);
assert.match(gateway,/server_claim_sms_jobs/);
assert.match(gateway,/PAIRING_RATE_LIMITED/);
assert.match(gateway,/body:null/);
assert.match(calls,/action==="incoming"/);
assert.match(calls,/phone_verified_at/,"incoming calls only share verified caller numbers");
assert.match(calls,/allow_number_based_server_calls===true/,"incoming calls only share caller numbers after explicit consent");
assert.match(androidMain,/val sharedPhone = call\.optString\("caller_phone_e164"\)/,
  "Android uses only the backend's shared verified caller number for contact matching");

assert.match(calls,/action==="accept"/);
assert.match(calls,/action==="end"/);
assert.match(calls,/server_rate_limit_allow/,
  "call starts have a bounded per-caller abuse limit");
assert.doesNotMatch(calls,/GUEST_INVITE_RATE_LIMITED/,
  "guest invites do not impose a separate recipient quota beyond the caller-wide safety limit");
assert.match(atomicCallMigration,/token_hash/,
  "guest invite links remain stored as token hashes inside the database transaction");
assert.match(atomicCallMigration,/p_invite_expires_at/,
  "guest invite links remain time-limited inside the database transaction");
assert.match(calls,/delivery_mode:"manual_share"/);
assert.match(calls,/stun:stun\.cloudflare\.com:3478/,
  "authenticated Server calls offer a second free STUN discovery path");
assert.match(guest,/stun:stun\.cloudflare\.com:3478/,
  "guest invitations use the same additional STUN discovery path");
assert.match(guestWeb,/stun:stun\.cloudflare\.com:3478/,
  "browser guest peer has both STUN endpoints as a safe fallback");
assert.match(calls,/SERVER_TURN_URLS/,"authenticated calls can receive configured TURN relay endpoints");
assert.match(calls,/SERVER_TURN_SHARED_SECRET/,"TURN credentials are signed server-side and never embedded in the APK");
assert.match(calls,/crypto\.subtle\.sign\("HMAC"/,"TURN credentials use coturn REST HMAC authentication");
assert.ok(calls.includes("CLOUDFLARE_TURN_KEY_ID"),"managed Cloudflare TURN credentials are fetched only inside the call backend");
assert.ok(calls.includes("CLOUDFLARE_TURN_API_TOKEN"),"Cloudflare API tokens remain server-side secrets");
assert.ok(calls.includes("generate-ice-servers"),"Cloudflare TURN credentials use the official credential-generation endpoint");
assert.ok(calls.includes('ice_server_mode:"cloudflare-turn"'),"call responses identify Cloudflare TURN mode");
assert.ok(calls.includes('ice_server_mode:"coturn-turn"'),"call responses identify coturn TURN mode");
assert.ok(calls.includes('ice_server_mode:"stun-only"'),"call responses identify STUN-only fallback");
assert.ok(guest.includes("CLOUDFLARE_TURN_KEY_ID"),"no-install guest calls can use Cloudflare TURN");
assert.ok(guest.includes("generate-ice-servers"),"guest TURN credentials are generated by the backend");
assert.ok(guest.includes("ice_server_mode:iceConfig.ice_server_mode"),"guest join responses expose the selected ICE mode");
assert.ok(androidSessionManager.includes('put("action", "register_device")'),"persistent sessions restore the existing installation after refresh expiry");
assert.ok(androidSessionManager.includes("device_secret"),"persistent recovery uses the installation device secret");
assert.ok(androidSessionManager.includes("forceRefresh: Boolean"),"an authoritative HTTP 401 can force immediate session recovery");
assert.ok(androidTests.includes("expiredSessionRecoversSameServerIdentityFromPersistedDeviceCredentials"),"Android instrumentation tests persistent identity recovery");
assert.ok(androidTests.includes("import org.json.JSONObject"),"session recovery instrumentation test imports its JSON payload type");
assert.match(guest,/SERVER_TURN_URLS/,"guest calls use the same optional TURN relay configuration");
assert.match(iosModel,/stun:stun\.cloudflare\.com:3478/,"iOS fallback matches Android and browser STUN discovery");
assert.match(androidTelecom,/ServerTelecomCallEngine/,
  "the Android caller uses the Telecom-bound native WebRTC engine");
assert.match(calls,/sms_body:invitationText/,
  "the backend retains a compatibility alias for older clients without queuing SMS");
assert.doesNotMatch(calls,/server_sms_jobs|automatic_sms_queued|sourceEventId/,
  "new guest calls no longer use the paired SIM gateway SMS queue");
assert.match(gateway,/owner_user_id:session\.user_id/,"SIM gateway pairing codes are bound to the signed-in Server owner");
assert.match(gateway,/owner_user_id:pair\.owner_user_id/,"claimed SIM gateways inherit the pairing owner's identity");
assert.match(gatewayOwnerMigration,/add column if not exists owner_user_id uuid references auth\.users\(id\)/,"existing SIM gateway rows can be migrated to account ownership");
assert.match(gatewayGuestClaimMigration,/c\.caller_user_id=d\.owner_user_id/,"only the caller-owned SIM gateway can claim a guest invitation SMS job");

assert.match(calls,/invitation_text:invitationText/,"the backend returns a secure shareable caller-identifying guest preview invitation");
assert.match(androidMain,/normalizePhoneForServer/);
assert.ok(androidMain.includes("private fun shareGuestInvitation"),"Android shares guest invitations through apps the caller already uses");
assert.match(androidMain,/Intent\(Intent\.ACTION_SEND\)/,"guest invitations retain a system share-sheet fallback when the paired gateway is unavailable");
assert.match(androidMain,/Call using selected SIM/,"Android offers the caller their saved SIM fallback when Server cannot reach the recipient");
assert.match(androidMain,/Standard call charges may apply/,"Android warns that carrier attempts are operator-dependent and may be chargeable");
assert.doesNotMatch(androidCarrierDialer,/Intent\\.ACTION_CALL/,"the carrier fallback never silently places the call");
assert.match(androidFirebase,/maxAttempts = 4/,"transient FCM registration failures receive bounded retries");
assert.match(androidMain,/REACHABLE · SERVER \/ WEBRTC/,"the caller sees the reachable Server/WebRTC state");
assert.match(androidMain,/UNREACHABLE · SELECTED SIM/,"the caller sees the unreachable/selected-SIM state");
assert.match(androidMain,/PeerConnection\.IceConnectionState\.FAILED[\s\S]*?handoffToCarrierDialer\(fallback, callId\)/,"a failed WebRTC media path triggers selected-SIM fallback");
assert.match(androidMain,/Recipient availability is unknown until their browser connects/,
  "a guest invitation is not misrepresented as an active ring before the guest joins");
assert.match(androidEngine,/Recipient has a fresh Server presence heartbeat/,"Android Telecom logs the live-presence path");
assert.match(androidEngine,/throw ServerCallApiException\(status, result, reason\)/,
  "the Telecom HTTP client preserves structured recipient-offline responses for SIM fallback");
assert.match(androidEngine,/apiError\.errorCode == "RECIPIENT_OFFLINE"/,
  "the Telecom call engine recognises a Server-offline recipient before creating a call");
assert.match(androidEngine,/failCall\(message, dialNumber, automaticCarrierFallback = true\)/,
  "the Telecom engine authorizes automatic SIM fallback only for a confirmed-offline recipient");
assert.match(androidEngine,/automaticCarrierFallback: Boolean = false/,
  "system Telecom attempts automatic carrier placement only for specifically designated fallback cases");
assert.match(androidEngine,/failCall\(message, carrierFallbackPhone, automaticCarrierFallback = false\)/,
  "generic backend errors never automatically spend mobile airtime or risk a duplicate carrier call");
assert.match(androidMain,/allowAutomaticFallback = false/,
  "generic outgoing API errors retain the manual SIM handoff instead of automatically creating a second call");
assert.match(androidEngine,/ServerCarrierDialer\.placeAutomatically/,
  "the system Telecom call path routes eligible failures through the selected SIM only after explicit consent");
assert.match(androidGuestNotifications,/ServerCarrierDialActivity/,
  "the guest invitation notification exposes the same carrier handoff as the app UI");
assert.match(androidGuestNotifications,/"Call using selected SIM"/,
  "the guest invitation notification labels the selected SIM fallback explicitly");
assert.match(androidCarrierActivity,/ServerTelecomRegistry\.fallbackToCarrier\(callId\)/,
  "the notification SIM action ends the pending Server/guest call before opening the dialler");
assert.match(androidCarrierActivity,/ServerCarrierDialer\.createIntent\(this, phone\)/,
  "the notification SIM action opens the platform dialler with the selected calling account when available");
assert.match(androidCarrierDialer,/EXTRA_PHONE_ACCOUNT_HANDLE/,
  "the caller-selected SIM account is passed to Android Telecom for the carrier route");
assert.match(androidCarrierDialer,/telecom\.placeCall\(/,
  "automatic carrier fallback is submitted through Android Telecom without a second dialler tap");
assert.match(androidCarrierDialer,/hasAutomaticFallbackConsent/,
  "automatic carrier fallback is gated by explicit saved user consent");
assert.match(androidCarrierDialer,/Intent\.ACTION_DIAL/,
  "carrier fallback uses Android's user-confirmed dialler");
assert.doesNotMatch(androidCarrierDialer,/Intent\.ACTION_CALL/,
  "carrier fallback never silently places a chargeable cellular call");
assert.match(androidTelecom,/fun fallbackToCarrier\(callId: String\)/,
  "the system Telecom connection can be safely handed off to the carrier path");
assert.match(androidManifest,/ServerCarrierDialActivity/,
  "the explicit carrier handoff Activity is registered in the Android manifest");
assert.match(androidMain,/button\("Call using selected SIM"\)/,
  "the main app exposes the caller-confirmed selected-SIM fallback after Server reports unavailable");
assert.match(html,/Server cannot read your airtime balance/,"onboarding explains that the carrier checks prepaid balance and returns its normal insufficient-credit message");
assert.match(nativeWorkflow,/ANDROID17_CREDENTIAL_STORAGE_READY/,"Android 17 instrumentation starts only after app credential-encrypted storage is verified accessible");
assert.match(androidEngine,/device delivery is not confirmed/,"Android Telecom logs background delivery without claiming that the phone rang");
assert.match(androidEngine,/carrierFallbackPhone = target\.phoneNumber/,"the Android call engine retains the phone destination so the selected SIM can be offered when the caller has no data");
assert.match(androidEngine,/ICE path on this network[\s\S]{0,260}carrierFallbackPhone/,"a failed WebRTC network path offers the caller-confirmed carrier SIM fallback");

assert.doesNotMatch(androidMain,/SMS may incur your carrier's charge/,"Server does not label an SMS invitation as a supported default guest-call route");
assert.match(androidMain,/push provider accepted an incoming-call alert request/,"the caller is told when a push provider accepted the alert request without claiming delivery");
assert.match(androidFirebase,/fcm_registered_server_id/,"push-token registration is scoped to the signed-in Server identity");
assert.match(androidFirebase,/fun unregister\(context: Context\)/,"FCM endpoint cleanup is attempted when a user signs out");
assert.match(androidMain,/ServerPushRegistration\.unregister\(this\)/,"Android unregisters its push endpoint before clearing the local session");
assert.match(androidMain,/override fun onResume\(\)/,"Android retries push registration when the user returns to the app");
assert.match(androidMain,/ServerTelecomRegistry\.isEnabled\(this\)[\s\S]*?ServerIncomingCallService\.start\(this\)/,"Android rechecks Calling accounts and restarts the incoming-call listener after returning from system settings");
assert.match(androidMain,/20-minute invitation window/);
assert.doesNotMatch(androidMain,/30_000/,"Android does not end guest or Server calls after a local 30-second timer");
assert.match(androidCarrierDialer,/TelecomManager\.EXTRA_PHONE_ACCOUNT_HANDLE/,
  "the saved SIM is preselected through Android's documented dialler account extra when still active");
assert.ok(iosModel.includes("normalizePhoneForServer"),"iOS normalizes national-format contact numbers");
assert.match(iosModel,/import PhoneNumberKit/,"iOS uses maintained global numbering metadata instead of country-specific digit heuristics");
assert.match(iosModel,/PhoneNumberUtility\(\)/,"iOS reuses one parsed numbering metadata utility");
assert.match(iosModel,/Locale\.current\.region\?\.identifier/,"iOS national-format numbers use the actual device region and fail closed when it is unavailable");
assert.match(iosModel,/phoneNumberUtility\.format\(parsed, toType: \.e164\)/,"iOS sends canonical E.164 destinations to the global call backend");
assert.doesNotMatch(iosModel,/digits\.count == 11 && digits\.hasPrefix\("0"\) \{ candidate = "\\+234"/,"iOS no longer hardcodes Nigerian national-number lengths or prefixes");

assert.match(androidMain,/deliveryMode == "manual_share"/);
assert.match(androidMain,/api\("availability"/,"Android checks recipient availability before the caller presses Call");
assert.match(androidFirebase,/if \(!ServerCallNotifications\.canPostNotifications\(context\)\)/,
  "FCM tokens are not advertised as background-call receivers when Android notification permission is disabled");
assert.match(androidCallNotifications,/areNotificationsEnabled\(\)/,
  "background call availability checks Android app-wide notification enablement");
assert.match(androidCallNotifications,/channel\.importance != NotificationManager\.IMPORTANCE_NONE/,
  "a disabled incoming-call notification channel prevents the device being advertised as background-reachable");
assert.match(androidFirebase,/unregister\(context\)/,
  "Server removes a previously registered push receiver when app entry detects notification permission is revoked");
assert.match(androidMain,/override fun onResume\(\)[\s\S]{0,420}ServerPushRegistration\.syncFcmToken/,
  "Server refreshes Android push registration after returning from notification settings");
assert.equal((androidMain.match(/override fun onResume\(\)/g) || []).length, 1,
  "the Android caller must have one lifecycle onResume implementation");
assert.match(androidSetup,/override fun onResume\(\)[\s\S]{0,420}ServerPushRegistration\.syncFcmToken/,
  "the website-hosted Android onboarding also refreshes push eligibility when resumed");
assert.match(app,/background incoming-call alerts may not appear/,
  "onboarding explains that denied Android notifications disable reliable background incoming-call alerts without blocking carrier fallback");
assert.match(androidMain,/recipientAvailabilityText/,"Android displays a distinct recipient reachability state beside the dialled destination");
assert.match(androidMain,/background wake receiver exists/,"the app does not claim to know the recipient's actual mobile-data state");
assert.match(androidMain,/started\.optString\("invitation_text"/,"Android prefers the explicit manual-share invitation field from the backend");
assert.match(iosModel,/guestInviteMessage/);
assert.ok(iosView.includes("ShareLink(item: model.guestInviteMessage"));
assert.match(calls,/next_after_seq/);
assert.match(guest,/GUEST_INVITE_EXPIRED_OR_INVALID/);
assert.match(guest,/RTCPeerConnection|server_call_signals/);
 assert.match(calls,/SERVER CALL:/,"the shared guest invitation clearly announces an incoming Server call");
 assert.match(guest,/caller_label:callerLabel/,"the no-install guest page receives the verified caller label");
assert.match(calls,/server-guest-preview\?token=/,"guest share links open a dynamic caller-branded preview before the full-screen call page");
assert.match(calls,/action==="availability"/,"callers can check recipient availability before creating a call");
assert.match(calls,/p_scope:"recipient_availability"/,"recipient availability checks are rate-limited per authenticated caller");
assert.match(calls,/A phone number alone cannot reveal whether an unregistered recipient currently has mobile data or Wi-Fi/,"unknown guest data connectivity is never guessed from a phone number");
assert.match(guestBrowserE2e,/server-guest-preview/,"the browser E2E accepts the caller-identifying Open Graph preview URL");
assert.match(guestBrowserE2e,/SERVER_GUEST_OG_CARD_PASS/,"browser E2E verifies caller identity in Open Graph metadata and the PNG bytes");
assert.match(guestBrowserE2e,/new URL\(invitationCandidate\)/,"the browser E2E parses and opens the exact shared preview link");
assert.match(guestPreview,/og:title/,"the guest preview publishes a social-card caller title for messaging apps");
assert.match(guestPreview,/og:image/,"the guest preview publishes incoming-call artwork for rich link cards");
assert.match(guestPreview,/og:image:alt/,"the preview image alt text names the actual caller identity");
assert.match(guestPreview,/content-type.*image[\\/]png/,"caller-specific Open Graph artwork is served as PNG rather than SVG");
assert.match(guestPreview,/image=1&invite_id=/,"each call preview links to a private caller-specific image");
assert.match(guestPreview,/CALLER IDENTIFICATION/,"the image visibly labels the caller identity");
assert.match(guestPreview,/pngChunk\("tEXt",callerMetadata\)/,"the PNG embeds inspectable caller identity metadata for production acceptance tests");
assert.match(guestPreview,/allow_number_based_server_calls/,"the OG card only displays a verified phone when the caller opted into number-based calling");
assert.match(guest,/allow_number_based_server_calls/,"the full-screen guest page observes the caller's phone-sharing consent");
assert.match(calls,/profile\.allow_number_based_server_calls===true/,"caller phone numbers are not included in invitations without explicit number-calling consent");
assert.match(guest,/:"Private caller"/,
  "the no-install guest page uses a neutral private-caller label when the number is not shared");
assert.match(androidIdentityResolver,/ContactsContract\.PhoneLookup\.CONTENT_FILTER_URI/,
  "Android resolves the verified caller number against the recipient's local Contacts database");
assert.match(androidIncoming,/ServerCallerIdentityResolver\.resolve/,
  "background incoming-call notifications use the recipient's local contact-name lookup");
assert.match(androidIncoming,/reportIncoming\(this, callId, callerPhone \?: "Server caller"\)/,
  "background Telecom handoff preserves the verified caller number instead of passing the resolved display name");
assert.match(androidTelecom,/ServerCallerIdentityResolver\.resolve/,
  "Android supplies the recipient-local contact name to its native incoming-call surfaces");
assert.match(androidTelecom,/setCallerDisplayName\(callerIdentity, TelecomManager\.PRESENTATION_ALLOWED\)/,
  "an unsaved caller is presented using the actual E.164 number instead of a private label or Server ID");
assert.match(html,/show this number as my caller ID/,
  "phone-number consent explains that a verified number is also used as outgoing caller ID");
assert.match(androidTests,/Habib TNC/,
  "Android Telecom instrumentation covers a recipient-saved contact name");
assert.match(androidTests,/An unsaved caller must display the real phone number/,
  "Android Telecom instrumentation covers an unsaved number fallback");
assert.match(iosModel,/reportIncoming\(id: id, callerName: caller\)/,
  "iOS passes the actual Server caller display identity to CallKit");
assert.match(iosModel,/update\.localizedCallerName = displayName/,
  "CallKit presents the Server caller's display name instead of treating it as a phone number");
assert.match(iosModel,/CXHandle\(type: \.generic, value: "Server"\)/,
  "the caller display label uses a generic CallKit handle and does not impersonate a cellular number");
assert.match(iosModel,/phoneNumber: String\? = nil, callerName: String\? = nil/,
  "iOS supports consented phone-number handles and display-name-only PushKit handles through one CallKit adapter");
assert.match(iosModel,/rawPhone\.range\(of:/,
  "CallKit validates consented phone numbers before constructing a telephone handle");
assert.match(iosModel,/if let safePhone[\s\S]*?CXHandle\(type: \.phoneNumber, value: safePhone\)/,
  "the iOS CallKit telephone handle is only used for the number returned by the consent-gated backend");
assert.match(androidIncoming,/caller_phone_e164/,
  "incoming Android notifications prefer the verified phone number over a Server ID");
assert.match(guestPreview,/location\.replace/,"opening the preview forwards the recipient to the secure full-screen guest call page");
assert.match(guestPreviewImage,/INCOMING INTERNET CALL/,"the link-preview artwork is visibly branded as an incoming call");

 assert.match(guestWeb,/iceTransportPolicy:joined\.ice_server_mode&&joined\.ice_server_mode!=="stun-only"\?"relay":"all"/,"guest browser forces TURN relay when valid TURN credentials are provisioned");
assert.match(androidEngine,/"outbound-rtp"/,"Android does not call audio ready from inbound RTP alone");
assert.match(androidEngine,/totalAudioEnergy/,"Android requires non-zero inbound and outbound audio energy");
assert.match(guestWeb,/outbound-rtp/,"guest browser verifies browser microphone RTP is sent to Android");
assert.match(guestWeb,/totalAudioEnergy/,"guest browser requires non-zero audio energy in both directions");
assert.match(guestBrowserE2e,/guest-audio-stats\.json/,"browser E2E persists bidirectional audio statistics");
assert.match(guestBrowserE2eShell,/module-null-sink/,"browser E2E injects a deterministic audio pilot into the Android emulator microphone path");
assert.match(guestBrowserE2eShell,/server-android-mic-tone\.wav/,"Android microphone pilot is a generated test WAV rather than ambient host silence");
assert.match(androidTests,/debug_last_outbound_audio_rtp_packets/,"Android E2E asserts locally transmitted microphone packets");
assert.match(androidTests,/debug_last_outbound_audio_rtp_energy/,"Android E2E asserts non-zero microphone audio energy");

 assert.match(androidEngine,/iceTransportsType = PeerConnection\.IceTransportsType\.RELAY/,"Android forces TURN relay when valid TURN credentials are provisioned");
assert.match(androidMain,/callIceServerMode == "cloudflare-turn" \|\| callIceServerMode == "coturn-turn"/,
  "the standalone Android caller also forces TURN relay when backend mode requires it");


const configCode=config.split("\n").filter(line=>!line.trim().startsWith("//")).join("\n");
assert.doesNotMatch(configCode,/service[_-]?role|sb_secret/i,"browser config contains no privileged key");
assert.match(config,/hzuovekqsjtpvmbuybxs\.supabase\.co/);
assert.doesNotMatch(app,/request_otp|verify_otp/);
assert.doesNotMatch(app,/server-handoff|server-auth/);
assert.doesNotMatch(app,/signInWithOtp|verifyOtp\(/);
assert.match(app,/server:\/\/device-setup/);
assert.match(guestWeb,/getUserMedia/);
assert.match(guestWeb,/RTCPeerConnection/);
assert.match(calls,/caller-identifying preview link/,
  "non-Server invitation explains that the recipient can answer through the browser without an app");
assert.match(guestPreview,/"PRIVATE CALLER"/,
  "the Open Graph preview never exposes an opaque Server ID when caller-number sharing is disabled");
assert.match(guest,/caller_server_id:callerLabel/,
  "guest invitation verification returns a human-facing label rather than a Server ID");
assert.match(guestWeb,/loadInvitation/);
assert.match(guestWeb,/You do not need to install Server/,
  "browser invitation tells a non-Server recipient no install is required");

assert.ok(androidTestCountCheck.includes("if total < 1"),
  "Android CI must fail when an instrumentation selector executes zero tests");
assert.ok(nativeWorkflow.includes("scripts/assert-android-test-count.py"),
  "Android compatibility jobs must verify that tests actually ran");
for (const method of [
  "internationalNumberingMetadataCoversEverySupportedRegion",
  "destinationCountryFromSavedContactMetadataBeatsCallerRegion",
  "explicitInternationalNumbersAndCallerRegionFallbackRemainSupported",
  "launcherShowsHybridOnboardingWithFallbackSimChoice",
  "guestCallInvitationNotificationOffersShareAndSelectedSimActions",
  "serverCallUsesInternetCapabilityWithoutCarrierValidationFalseNegatives",
  "preinstalledPhoneDialerOffersServerAsAnOutgoingCallChoice",
  "enabledServerAccountRingsThroughAndroidTelecomForIncomingCalls",
  "phoneAccountCanReceiveIncomingCallThroughTelecom",
  "serverRegistersAsSystemManagedPhoneAccountAndUsesOnlyExplicitlyLinkedNumberMetadata",
  "incomingServerCallPostsNativeCallStyleAlertWithRingtoneAndDndSettings",
  "missedServerCallNotificationOffersQuietCallbackAction",
  "vanishedUnansweredIncomingCallIsDisconnectedFromSystemTelecom",
  "telecomHangupUsesCallIdFromSystemIntentWhenActivityHasNoCallState"
]) {
  assert.ok(androidTests.includes(`fun ${method}(`), `Android instrumentation method ${method} must exist`);
}

assert.ok(!nativeWorkflow.includes("android12PhoneAccountCanReceiveServerCallThroughTelecom"),
  "Android 12 must not use the old nonexistent test method selector");
assert.ok(androidVersionMatrix.includes("-Pandroid.testInstrumentationRunnerArguments.class=com.server.caller.CallerSmokeTest"),
  "Android 12 and Android 16 run the complete shared instrumentation suite");
assert.ok(androidTests.includes("fun incomingServerCallPostsNativeCallStyleAlertWithRingtoneAndDndSettings"));
assert.ok(androidTests.includes("fun missedServerCallNotificationOffersQuietCallbackAction"));
assert.ok(androidEmulatorSmoke.includes("scripts/assert-android-test-count.py --expected-tests 17"),
  "the main API 34 emulator must execute all 17 acceptance tests without skips or failures");

for (const p of ["web/index.html","web/styles.css","web/terms.html","web/privacy.html","supabase/config.toml","supabase/functions/server-auth/index.ts","supabase/functions/server-handoff/index.ts","supabase/migrations/20261021124332_server_custom_phone_auth.sql","supabase/migrations/20261021195856_server_app_handoff.sql","supabase/migrations/20261022100500_server_device_first_identity.sql"]) assert.ok(existsSync(resolve(root,p)),"expected file "+p);
assert.match(offlineMissedCallMigration,/server_create_missed_call_atomic/);
assert.match(calls,/server_create_missed_call_atomic/);
assert.match(callStateTransitionMigration,/server_guest_transition_atomic/);
assert.match(callStateTransitionMigration,/server_call_transition_atomic/);
assert.match(guestSingleClaimMigration,/v_invite\.joined_at is not null/);
assert.match(guestSingleClaimMigration,/GUEST_ALREADY_JOINED/);
assert.match(guest,/GUEST_ALREADY_JOINED/);
assert.match(guestWeb,/details\.joined===true/);
assert.match(liveGuestTransitionContract,/one-time guest join claim serialized/);

assert.ok(activeRenegotiationMigration.includes("and v_call.state in ('ringing','connecting')"),
  "atomic transitions preserve the locked call row if offer/answer signalling arrives after ACTIVE");
assert.match(guestPreview,/GUEST_PREVIEW_INVITE_LOOKUP_FAILED/);
assert.match(guestPreview,/GUEST_PREVIEW_CALL_LOOKUP_FAILED/);
assert.match(guestPreview,/GUEST_PREVIEW_CALLER_PROFILE_LOOKUP_FAILED/);

assert.match(liveGuestTransitionContract,/"join"/);
assert.match(liveGuestTransitionContract,/og:title/);
assert.match(liveGuestTransitionContract,/Caller=PRIVATE CALLER/);
assert.ok(liveGuestTransitionContract.includes("server-terms-1.0"));
assert.doesNotMatch(liveGuestTransitionContract,/request_otp|verify_otp|server-send-sms/,
  "the live guest lifecycle test must never queue SMS or contact a real carrier number");

assert.match(callStateTransitionMigration,/revoke all on function public\.server_guest_transition_atomic/);
assert.match(callStateTransitionMigration,/grant execute on function public\.server_call_transition_atomic/);
assert.ok(keepAliveMigration.includes("create or replace function public.server_keepalive_probe()"));
assert.ok(keepAliveMigration.includes("grant execute on function public.server_keepalive_probe() to anon"));
assert.ok(keepAliveMigration.includes("notify pgrst, 'reload schema'"));
assert.ok(activeCallLeaseMigration.includes("server_calls_active_expiry_idx"),"active call expiry is indexed for the minute maintenance worker");
assert.ok(activeCallLeaseMigration.includes("v_now+interval '10 minutes'"),"answered and guest-joined calls receive a bounded setup-negotiation lease");
assert.ok(activeCallLeaseMigration.includes("v_now+interval '24 hours'"),"active Server and guest calls receive a 24-hour renewable-by-transition lease");
assert.ok(activeCallLeaseMigration.includes("state='active'") && activeCallLeaseMigration.includes("v_active_timed_out"),"maintenance fails orphaned active calls after their lease expires");
assert.ok(activeCallLeaseMigration.includes("GUEST_ALREADY_JOINED"),"guest single-claim protection remains in the replacement transition function");
assert.ok(activeCallLeaseMigration.includes("revoke all on function public.server_call_transition_atomic") && activeCallLeaseMigration.includes("grant execute on function public.server_call_transition_atomic") && activeCallLeaseMigration.includes("to service_role"),"call transition RPC remains service-role-only");

assert.ok(keepAliveMigration.includes("security invoker"));
assert.ok(keepAliveWorkflow.includes("13 */8 * * *"));
assert.ok(keepAliveWorkflow.includes("/rest/v1/rpc/server_keepalive_probe"));
assert.ok(keepAliveWorkflow.includes("SERVER_SUPABASE_PUBLISHABLE_KEY"));
assert.doesNotMatch(keepAliveWorkflow,/SERVICE_ROLE|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/);
assert.match(guest,/db\.rpc\("server_guest_transition_atomic"/,
  "guest join, decline, signal and leave use atomic database state transitions");
assert.match(calls,/db\.rpc\("server_call_transition_atomic"/,
  "Server answer, end, active state and signalling use atomic database transitions");
assert.match(calls,/CALL_ACCESS_LOOKUP_FAILED/,
  "TURN credentials are only issued after verifying membership in the target call");
assert.match(guest,/CALLER_PROFILE_LOOKUP_FAILED/,
  "guest caller-profile database errors are surfaced as service failures, not hidden");

assert.match(calls,/missed_call_saved:true/);
assert.match(calls,/GUEST_INVITE_TTL_SECONDS = 24 \* 60 \* 60/);
assert.match(offlineInbox,/replicateRxCollection/);
assert.match(offlineInbox,/getRxStorageDexie/);
assert.match(offlineInbox,/rxdb@17\.6\.0/);
assert.match(guestWeb,/syncGuestInvite/);
assert.match(guestWeb,/server\.guest\.inbox\.v1/);
assert.match(guestServiceWorker,/server-guest-shell-v1/);
assert.match(guestWeb,/state==="missed"/);
assert.match(androidMain,/call\.optString\("state"\) == "missed"/);
assert.match(androidMain,/missed_call_saved/);
assert.match(androidEngine,/missed_call_saved/);
assert.match(offlineArchitecture,/private inbox per Server identity/i);
assert.match(offlineArchitecture,/contact-wide room/i);
assert.ok(androidUnlock.includes('run-as "$APP_ID" sh -c'),
  "the emulator unlock gate proves app-private credential-encrypted storage is accessible");
assert.ok(androidPackageManagerWait.includes("service check activity"),
  "emulator readiness waits for both activity and package services before installing apps");
assert.ok(androidEmulatorSmoke.includes("adb install -r artifacts/server-caller-debug-for-reinstall.apk"),
  "the main API 34 emulator installs Server before proving CE storage access");
assert.ok(nativeWorkflow.includes("adb install -r apps/android-caller/app/build/outputs/apk/debug/app-universal-debug.apk"),
  "the API 29–36 matrix installs the app before the credential-encrypted storage check");
assert.ok(android17InstallScript.includes('find "$ANDROID_HOME/build-tools"'),
  "Android 17 validation selects a zipalign executable from the Build Tools installed in that job");
assert.ok(android17InstallScript.includes("app_compat.enabled fatal") && android17InstallScript.includes("pm.16kb.app_compat.disabled true"),
  "Android 17 tests disable the 16 KB back-compat fallback and fail immediately on incompatible ELF binaries");
assert.ok(android17Preview.includes("runs-on: macos-15") && android17Preview.includes("system-images;android-37.0;google_apis_ps16k;arm64-v8a") && android17Preview.includes("arch: arm64-v8a"),
  "Android 17 has a native ARM64 16 KB emulator job, not only an x86_64 simulation");
assert.ok(android17Preview.includes("brew install coreutils llvm") && android17Preview.includes("brew --prefix llvm") && elfAlignmentScript.includes("llvm-readelf"),
  "the Apple Silicon Android 17 job uses native Homebrew LLVM tools to validate native library alignment");
assert.ok(android17InstallScript.includes("ANDROID17_DATA_AVAILABLE_KB") && android17InstallScript.includes("1048576"),
  "Android 17 installation fails early when the emulator data partition has less than 1 GiB free");
assert.ok(elfAlignmentScript.includes("PT_LOAD") && elfAlignmentScript.includes("0x4000"),
  "real-device ARM64 packages receive a native ELF PT_LOAD 16 KB alignment check");
assert.ok(nativeWorkflow.includes("check-16kb-elf-alignment.py arm64-v8a"),
  "CI validates both physical ARM64 debug and release package native libraries");
assert.ok(android17Preview.includes("ram-size: 4096M") && android17Preview.includes("disk-size: 8G"),
  "Android 17 ARM64 preview reserves 4 GB guest RAM and an 8 GB userdata disk on Apple Silicon");
console.log("Server backend/web contract checks: PASS");
console.log("Checks include hybrid WebRTC/SIM fallback, SIM metadata minimisation, recipient reachability, previewable guest calls, device permissions and public-key hygiene.");
console.log("Static checks only; they do not prove real SIM SMS or connected call audio.");
