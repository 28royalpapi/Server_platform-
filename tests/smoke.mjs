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
const androidVersionMatrix = nativeWorkflow.slice(nativeWorkflow.indexOf("  android-10-to-16-platform-matrix:"), nativeWorkflow.indexOf("  android-17-preview-compatibility:"));
const android17Preview = nativeWorkflow.slice(nativeWorkflow.indexOf("  android-17-preview-compatibility:"), nativeWorkflow.indexOf("  ios-simulator-build-and-preview:"));
const androidReaWorkflow=read(".github/workflows/server-rea-apk-audit.yml");
const androidEmulatorSmoke=read("scripts/android-emulator-smoke.sh");
const androidTestCountCheck=read("scripts/assert-android-test-count.py");
const android17Acceptance=read("scripts/android17-16kb-acceptance.sh");
const iosApp=read("apps/ios-caller/ServerCaller/ServerCallerApp.swift");
const iosInfo=read("apps/ios-caller/ServerCaller/Info.plist");
const iosEntitlements=read("apps/ios-caller/ServerCaller/ServerCaller.entitlements");
const iosProject=read("apps/ios-caller/ServerCaller.xcodeproj/project.pbxproj");
const iosModel=read("apps/ios-caller/ServerCaller/ServerViewModel.swift");
const iosView=read("apps/ios-caller/ServerCaller/ContentView.swift");
const auth=read("supabase/functions/server-auth/index.ts");
const androidIncoming=read("apps/android-caller/app/src/main/java/com/server/caller/ServerIncomingCallService.kt");
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
assert.match(androidFallbackSim,/PhoneAccount.CAPABILITY_SIM_SUBSCRIPTION/);
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
assert.match(androidMain,/Server needs internet to place this call/,
   "offline callers receive a plain instruction to enable mobile data or Wi-Fi");
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
assert.ok(android17Preview.includes("api-level: '37.0'"), "Android 17 preview job uses the SDK platform 37.0 package identifier");
assert.ok(android17Preview.includes("system-image-api-level: '37.0'"), "Android 17 preview job uses the 37.0 emulator image namespace");
assert.ok(android17Preview.includes("target: google_apis_ps16k"), "Android 17 preview job uses the supported 16 KB-page Google APIs image");
assert.match(nativeWorkflow,/api-level:\s*\[29,\s*30,\s*31,\s*32,\s*33,\s*34,\s*35,\s*36\]/, "Android 10 through Android 16, including Android 12L API 32 and Android 16 API 36, are the stable release matrix");
assert.ok(nativeWorkflow.includes("scripts/wait-for-android-package-manager.sh"), "every Android emulator test waits for Package Manager before installing the app");
assert.ok(nativeWorkflow.includes("internationalNumberingMetadataCoversEverySupportedRegion"), "the version matrix runs the current global-numbering test");
assert.ok(nativeWorkflow.includes("destinationCountryFromSavedContactMetadataBeatsCallerRegion"), "the version matrix runs the destination-country regression test");
assert.ok(nativeWorkflow.includes("explicitInternationalNumbersAndCallerRegionFallbackRemainSupported"), "the version matrix runs international-format parsing regressions");
assert.ok(!nativeWorkflow.includes("internationalContactNumbersUseTheCallerCountryOrExplicitDestinationCode"), "no Android CI job selects the removed first-block test");
assert.ok(nativeWorkflow.includes("if: github.head_ref != 'android-finish' && github.ref != 'refs/heads/android-finish'"), "the Android work branch does not run iOS CI");
assert.ok(androidVersionMatrix.includes("channel: stable"), "stable Android 10–16 matrix uses released SDK images");
assert.ok(androidVersionMatrix.includes("disk-size: 6G"), "stable Android emulator jobs use a 6 GB userdata partition");
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
assert.ok(android17Preview.includes("ram-size: 4096M") && android17Preview.includes("emulator-boot-timeout: 480"), "Android 17 preview receives the larger memory and startup budget");
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
assert.doesNotMatch(androidManifest,/android\.permission\.CALL_PHONE/,
  "Server opens Android's user-controlled dialer and does not place direct carrier calls");

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
assert.match(androidEngine,/inbound_audio_rtp_packets_received/);
assert.match(androidEngine,/RTCStatsCollectorCallback/);
assert.match(guestWeb,/inbound-rtp/);
assert.match(androidTests,/Caller received no inbound audio RTP packets/);
assert.match(androidTests,/Recipient received no inbound audio RTP packets/);
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
assert.doesNotMatch(androidGuestShare,/Intent\(Intent\.ACTION_SENDTO|smsto/,
  "Server uses the generic share chooser and does not force an addressed SMS invitation");
assert.doesNotMatch(androidGuestShare,/sendTextMessage|SmsManager\.send/,"the caller app delegates SMS transmission to the paired SIM gateway, not its own process");
assert.match(androidManifest,/android:name="com\.server\.caller\.ServerGuestInviteShareActivity"/,
  "the native share activity is available only after the user taps the guest invitation notification");
assert.match(androidPhoneNormalizer,/PhoneNumberUtil\.getInstance\(\)/,
  "all supported Android releases use the same bundled international numbering metadata");
assert.match(androidPhoneNormalizer,/phoneUtil\.parse\(value, defaultRegion\)/,
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
assert.match(androidFallbackSim,/PhoneAccount.CAPABILITY_SIM_SUBSCRIPTION/);
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
assert.match(androidMain,/no background wake job or accepted push was confirmed/,"the caller is told when no durable wake job or provider acceptance exists");
assert.match(androidMain,/background wake job is queued/,"the caller is told when its wake job is queued but not delivered");
assert.match(androidMain,/Available on Server/,"the caller sees when the recipient has fresh Server presence");
assert.match(androidMain,/background push endpoint is registered/,"the caller sees when only a background push endpoint is available");
assert.match(androidMain,/Recipient availability is unknown until their browser connects/,
  "a guest invitation is not misrepresented as an active ring before the guest joins");
assert.match(androidEngine,/Recipient has a fresh Server presence heartbeat/,"Android Telecom logs the live-presence path");
assert.match(androidEngine,/throw ServerCallApiException\(status, result, reason\)/,
  "the Telecom HTTP client preserves structured recipient-offline responses for SIM fallback");
assert.match(androidEngine,/apiError\.errorCode == "RECIPIENT_OFFLINE"/,
  "the Telecom call engine recognises a Server-offline recipient before creating a call");
assert.match(androidEngine,/failCall\(message, dialNumber\)/,
  "the Telecom engine shows the user-confirmed carrier handoff after ending the failed Server attempt");
assert.match(androidGuestNotifications,/ServerCarrierDialActivity/,
  "the guest invitation notification exposes the same carrier handoff as the app UI");
assert.match(androidGuestNotifications,/"Call using selected SIM"/,
  "the guest invitation notification labels the selected SIM fallback explicitly");
assert.match(androidCarrierActivity,/ServerTelecomRegistry\.fallbackToCarrier\(callId\)/,
  "the notification SIM action ends the pending Server/guest call before opening the dialler");
assert.match(androidCarrierActivity,/ServerCarrierDialer\.createIntent\(this, phone\)/,
  "the notification SIM action opens the platform dialler with the selected calling account when available");
assert.match(androidCarrierDialer,/EXTRA_PHONE_ACCOUNT_HANDLE/,
  "the caller-selected SIM is passed to Android's normal dialler where supported");
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
assert.match(androidEngine,/background wake job is queued/,"Android Telecom logs background delivery without claiming that the phone rang");
assert.match(androidMain,/SMS may incur your carrier's charge/,"Android discloses that a caller-selected SMS may be billable");
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
assert.match(androidMain,/deliveryMode == "manual_share"/);
assert.match(androidMain,/started\.optString\("invitation_text"/,"Android prefers the explicit manual-share invitation field from the backend");
assert.match(iosModel,/guestInviteMessage/);
assert.ok(iosView.includes("ShareLink(item: model.guestInviteMessage"));
assert.match(calls,/next_after_seq/);
assert.match(guest,/GUEST_INVITE_EXPIRED_OR_INVALID/);
assert.match(guest,/RTCPeerConnection|server_call_signals/);
 assert.match(calls,/SERVER CALL:/,"the shared guest invitation clearly announces an incoming Server call");
 assert.match(guest,/caller_label:callerLabel/,"the no-install guest page receives the verified caller label");
assert.match(calls,/server-guest-preview\?token=/,"guest share links open a dynamic caller-branded preview before the full-screen call page");
assert.match(guestPreview,/og:title/,"the guest preview publishes a social-card caller title for messaging apps");
assert.match(guestPreview,/og:image/,"the guest preview publishes incoming-call artwork for rich link cards");
assert.match(guestPreview,/location\.replace/,"opening the preview forwards the recipient to the secure full-screen guest call page");
assert.match(guestPreviewImage,/INCOMING INTERNET CALL/,"the link-preview artwork is visibly branded as an incoming call");

 assert.match(guestWeb,/iceTransportPolicy:joined\.ice_server_mode&&joined\.ice_server_mode!=="stun-only"\?"relay":"all"/,"guest browser forces TURN relay when valid TURN credentials are provisioned");
 assert.match(androidEngine,/iceTransportsType = PeerConnection\.IceTransportsType\.RELAY/,"Android forces TURN relay when valid TURN credentials are provisioned");

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
assert.match(calls,/profile\.server_id/,
  "guest invitation identifies the caller's Server ID");
assert.match(guest,/caller_server_id/,
  "guest invitation verification returns the Server caller ID");
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
console.log("Server backend/web contract checks: PASS");
console.log("Checks include hybrid WebRTC/SIM fallback, SIM metadata minimisation, recipient reachability, previewable guest calls, device permissions and public-key hygiene.");
console.log("Static checks only; they do not prove real SIM SMS or connected call audio.");
