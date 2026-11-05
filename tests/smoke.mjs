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
const authMigration=read("supabase/migrations/20261021124332_server_custom_phone_auth.sql");
const handoffMigration=read("supabase/migrations/20261021195856_server_app_handoff.sql");
const deviceMigration=read("supabase/migrations/20261022100500_server_device_first_identity.sql");
const handoff=read("supabase/functions/server-handoff/index.ts");
const androidMain=read("apps/android-caller/app/src/main/java/com/server/caller/MainActivity.kt");
const androidSetup=read("apps/android-caller/app/src/main/java/com/server/caller/ServerSetupWebActivity.kt");
const androidTelecom=read("apps/android-caller/app/src/main/java/com/server/caller/ServerConnectionService.kt");
const androidEngine=read("apps/android-caller/app/src/main/java/com/server/caller/ServerTelecomCallEngine.kt");
const androidPhoneNormalizer=read("apps/android-caller/app/src/main/java/com/server/caller/ServerPhoneNumberNormalizer.kt");
const androidGuestNotifications=read("apps/android-caller/app/src/main/java/com/server/caller/ServerGuestInviteNotifications.kt");
const androidGuestShare=read("apps/android-caller/app/src/main/java/com/server/caller/ServerGuestInviteShareActivity.kt");
const androidBuild=read("apps/android-caller/app/build.gradle.kts");
const androidCallNotifications=read("apps/android-caller/app/src/main/java/com/server/caller/ServerCallNotifications.kt");
const androidManifest=read("apps/android-caller/app/src/main/AndroidManifest.xml");
const androidTests=read("apps/android-caller/app/src/androidTest/java/com/server/caller/CallerSmokeTest.kt");
const nativeWorkflow=read(".github/workflows/build-server-native.yml");
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
assert.match(androidIncoming,/Server session refresh deferred/,"transient token-refresh failures must retry instead of stopping the incoming-call listener");
assert.match(androidIncoming,/Server session refresh rejected/,"permanent token-refresh failures are rejected");
assert.match(androidIncoming,/tokenExpired/,"polling distinguishes expired offline sessions from revoked valid sessions");
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
assert.doesNotMatch(androidSetup,/READ_PHONE_NUMBERS|SubscriptionManager|simChoicesJson|requestSimPermissions|selectSim/,
  "the Android onboarding bridge does not read SIM subscriptions or phone numbers");
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
assert.match(nativeWorkflow,/apps\/android-caller\/app\/build\/outputs\/apk\/debug\/app-universal-debug\.apk/,
  "the universal caller debug APK must be included in uploaded diagnostics");
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
assert.match(androidReaWorkflow,/ServerTelecomCallEngine\$onIceConnectionChange\$1/,
  "compiled APK audit must verify the compiler-generated ICE callback descriptor in DEX without relying on REA's unstable synthetic class naming");
assert.match(androidReaWorkflow,/ServerTelecomCallEngine onIceConnectionChange/,
  "compiled APK inspection must verify the call engine's real ICE-connected state handling");
assert.doesNotMatch(androidReaWorkflow,/MainActivity startCall|MainActivity preparePeer|MainActivity handleSignal/,
  "the call-engine audit must not use the obsolete Activity WebRTC implementation");
assert.match(androidTests,/enablePhoneAccountWithTestShell/);
assert.match(nativeWorkflow,/api-level: 26/, "Android 8 remains a minimum-install compatibility check");
assert.match(nativeWorkflow,/api-level:\s*\$\{\{\s*matrix\.api-level\s*==\s*37\s*&&\s*'37\.0'\s*\|\|\s*matrix\.api-level\s*\}\}/, "Android 17 uses the SDK platform's 37.0 package identifier");
assert.match(nativeWorkflow,/system-image-api-level:\s*\$\{\{\s*matrix\.api-level\s*==\s*37\s*&&\s*'37\.0'\s*\|\|\s*matrix\.api-level\s*\}\}/, "Android 17 uses the 37.0 emulator image namespace");
assert.match(nativeWorkflow,/target:\s*\$\{\{\s*matrix\.api-level\s*==\s*37\s*&&\s*'google_apis_ps16k'/, "Android 17 uses the supported 16 KB-page Google APIs image");
assert.match(nativeWorkflow,/api-level:\s*\[29,\s*30,\s*31,\s*32,\s*33,\s*34,\s*35,\s*36,\s*37\]/, "Android 10 through Android 17, including Android 12L API 32 and Android 16 API 36, are in the matrix");
assert.ok(nativeWorkflow.includes("scripts/wait-for-android-package-manager.sh"), "every Android emulator test waits for Package Manager before installing the app");
assert.ok(nativeWorkflow.includes("internationalNumberingMetadataCoversEverySupportedRegion"), "the version matrix runs the current global-numbering test");
assert.ok(nativeWorkflow.includes("destinationCountryFromSavedContactMetadataBeatsCallerRegion"), "the version matrix runs the destination-country regression test");
assert.ok(nativeWorkflow.includes("explicitInternationalNumbersAndCallerRegionFallbackRemainSupported"), "the version matrix runs international-format parsing regressions");
assert.ok(!nativeWorkflow.includes("internationalContactNumbersUseTheCallerCountryOrExplicitDestinationCode"), "no Android CI job selects the removed first-block test");
assert.ok(nativeWorkflow.includes("if: github.head_ref != 'android-finish' && github.ref != 'refs/heads/android-finish'"), "the Android work branch does not run iOS CI");
assert.match(nativeWorkflow,/channel: stable/, "Android 17 uses the released stable SDK channel, not Canary");
assert.ok(nativeWorkflow.includes("disk-size: ${{ matrix.api-level == 37 && '3G' || '6G' }}"), "Android 17 uses a 3 GB userdata partition so its 16 KB image fits the GitHub runner disk while accommodating the app and instrumentation tests");
assert.ok(!nativeWorkflow.includes("android-16-stable-compatibility-smoke"), "Android 16 is tested once in the unified version matrix");
assert.ok(androidTests.includes("Manifest.permission.READ_CONTACTS"), "the Telecom instrumentation test grants Contacts access before testing national-format dialer destinations");
assert.ok(androidPhoneNormalizer.includes('private val E164 = Regex("^\\\\+[1-9][0-9]{1,14}$")'), "global E.164 parsing accepts short valid international numbers after libphonenumber validates them");
assert.match(androidTests,/preinstalledPhoneDialerOffersServerAsAnOutgoingCallChoice/, "system Phone chooser test uses explicit E.164 destination to isolate Telecom integration");
assert.match(androidTests,/serverCallUsesInternetCapabilityWithoutCarrierValidationFalseNegatives/,
   "mobile-data connectivity gating has an Android instrumentation test that ignores captive-portal validation false negatives");
assert.match(androidTests,/Outgoing Telecom flow must wait for the Server backend result/,
   "the preinstalled Phone-app test verifies outgoing calls are not backgrounded before backend success or failure");
assert.match(androidTests,/launcherShowsServerIdFirstOnboardingWithoutSimPermissions/);
const androidVersionMatrix = nativeWorkflow.slice(nativeWorkflow.indexOf("  android-10-to-17-platform-matrix:"), nativeWorkflow.indexOf("  ios-simulator-build-and-preview:"));
assert.ok(androidVersionMatrix.includes("-Pandroid.testInstrumentationRunnerArguments.class=com.server.caller.CallerSmokeTest"), "every Android 10–17 API runs the complete instrumentation class, including onboarding and Telecom acceptance");
assert.ok(androidVersionMatrix.includes("assert-android-test-count.py --expected-tests 14"), "every Android 10–17 API must execute all 14 acceptance tests without skipped or failed tests");
assert.ok(androidVersionMatrix.includes('if [ "${{ matrix.api-level }}" = "37" ]; then sh scripts/android17-16kb-acceptance.sh; fi'), "Android 17 validation is invoked as one POSIX shell command inside the emulator runner");
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
assert.match(androidBuild,/isUniversalApk = true/);
assert.match(nativeWorkflow,/bundleRelease -PSERVER_ENABLE_RELEASE_ABI_SPLITS=false/);
assert.match(nativeWorkflow,/assembleRelease -PSERVER_ENABLE_RELEASE_ABI_SPLITS=true/);
assert.match(read("apps/android-caller/build.gradle.kts"),/version "8\.9\.1"/);
assert.doesNotMatch(read("web/app.js"),/\?\./);
assert.match(androidBuild,/androidx\.fragment:fragment-ktx:1\.9\.1/);
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
assert.match(androidEngine,/put\("source", "android_telecom"\)/,
  "system Phone calls identify their origin so the backend can use the explicit native guest-share route");
assert.match(androidMain,/if \(pendingSystemDialerReturn\) payload\.put\("source", "android_telecom"\)/,
  "the legacy Android Phone intent bridge must use the same backend no-guest route guard");
assert.match(androidEngine,/ServerGuestInviteNotifications\.show\(context, callId\.orEmpty\(\), target, invitation\)/,
  "a non-Server contact receives an explicit notification to share the expiring browser invitation");
assert.match(androidGuestNotifications,/NotificationCompat\.Action|addAction/,
  "the no-install route uses a native notification action rather than opening a caller webpage");
assert.match(androidGuestShare,/Intent\(Intent\.ACTION_SEND\)/,
  "the caller explicitly opens Android's native share chooser");
assert.match(androidGuestShare,/Intent\(Intent\.ACTION_SENDTO, Uri\.fromParts\("smsto", phone, null\)\)/,
  "the SMS composer is addressed to the selected saved contact");
assert.doesNotMatch(androidGuestShare,/sendTextMessage|SmsManager\.send/,"Server never sends an SMS without the caller tapping Send");
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
  "guest invitations are returned for an explicit user-initiated share rather than automatic SMS");
assert.match(androidTelecom,/override fun onDisconnect\(\) \{\s*setRingbackRequested\(false\)/,
  "system disconnect must stop any active Telecom ringback");
assert.match(androidTests,/preinstalledPhoneDialerOffersServerAsAnOutgoingCallChoice/);
assert.match(androidTests,/Intent\(Intent\.ACTION_DIAL\)/,
  "outgoing-call acceptance opens Android's real Phone dialer");
assert.match(androidTests,/By\.res\(resolvedDialerPackage, "digits"\)/,
  "the test locates the Phone dialer's destination EditText");
assert.match(androidTests,/digitsField!!\.setText\("\+2348012345678"\)/,
  "the test enters an explicit E.164 destination into the real dialer EditText without keycode assumptions");
assert.match(androidTests,/displayedDestinationDigits/,
  "dialer acceptance tolerates visual grouping while checking every E.164 digit");
assert.match(androidTests,/debug_last_telecom_request_target_length/,
  "outgoing-call acceptance verifies the full E.164 target reaches Android Telecom");
assert.doesNotMatch(androidTests,/Hiding the keyboard must leave the entered destination in the dialpad|device\.pressBack\(\).*dialpad/,
  "the Phone picker must not press Back and accidentally close Android's dialpad");
assert.match(androidTests,/input_method_nav_back/,
  "the Phone picker uses the system IME navigation control rather than Android Phone Back");
assert.match(androidTests,/guestCallInvitationNotificationOffersExplicitShareAndSmsActions/,
  "the no-install guest route has an executable native notification and SMS/share chooser test");
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
assert.match(html,/releases\/download\/server-android-connector-preview\/app-universal-release\.apk/,
  "website installer points to the published Android preview asset");
assert.match(html,/I'?ve installed Server — continue setup/,
  "website offers the return-to-this-page hand-off after connector installation");
assert.match(app,/androidDownload && androidDownload\.addEventListener/,
  "website explains that the user should return after the APK download");

assert.match(androidTelecom,/reconcileIncoming\(liveCallIds: Set<String>\)/,"incoming Telecom calls are reconciled against backend ringing state");
assert.match(androidIncoming,/ServerTelecomRegistry.reconcileIncoming\(liveCallIds\)/,"the background listener clears unanswered calls that disappear from the backend");
assert.match(androidTelecom,/PhoneAccount.SCHEME_TEL/);
assert.doesNotMatch(androidTelecom,/PhoneAccount.CAPABILITY_SIM_SUBSCRIPTION/);
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
assert.match(guest,/SERVER_TURN_URLS/,"guest calls use the same optional TURN relay configuration");
assert.match(iosModel,/stun:stun\.cloudflare\.com:3478/,"iOS fallback matches Android and browser STUN discovery");
assert.match(androidTelecom,/ServerTelecomCallEngine/,
  "the Android caller uses the Telecom-bound native WebRTC engine");
assert.match(calls,/sms_body:smsBody/);
assert.match(calls,/Server does not send automatic or paid SMS for guest invitations/);
assert.doesNotMatch(calls,/category:"guest_invite"/,"guest invitations are never queued for automatic paid SMS delivery");
assert.match(calls,/invitation_text:smsBody/,"the backend returns a secure shareable guest invitation message");
assert.match(androidMain,/normalizePhoneForServer/);
assert.ok(androidMain.includes("private fun shareGuestInvitation"),"Android shares guest invitations through apps the caller already uses");
assert.match(androidMain,/Intent\(Intent\.ACTION_SEND\)/,"guest invitations use the system share sheet rather than forcing SMS");
assert.doesNotMatch(androidMain,/private fun notifyCarrierFallback|Try a normal carrier call|charges may apply/,"Android must not offer a paid cellular fallback when Server calling fails");
assert.match(androidFirebase,/maxAttempts = 4/,"transient FCM registration failures receive bounded retries");
assert.match(androidMain,/no push provider accepted a wake alert/,"the caller is told when no push provider accepted an incoming-call alert");
assert.match(androidMain,/SMS may incur your carrier's charge/,"Android discloses that a caller-selected SMS may be billable");
assert.match(androidMain,/push provider accepted an incoming-call alert request/,"the caller is told when a push provider accepted the alert request without claiming delivery");
assert.match(androidFirebase,/fcm_registered_server_id/,"push-token registration is scoped to the signed-in Server identity");
assert.match(androidFirebase,/fun unregister\(context: Context\)/,"FCM endpoint cleanup is attempted when a user signs out");
assert.match(androidMain,/ServerPushRegistration\.unregister\(this\)/,"Android unregisters its push endpoint before clearing the local session");
assert.match(androidMain,/override fun onResume\(\)/,"Android retries push registration when the user returns to the app");
assert.match(androidMain,/ServerTelecomRegistry\.isEnabled\(this\)[\s\S]*?ServerIncomingCallService\.start\(this\)/,"Android rechecks Calling accounts and restarts the incoming-call listener after returning from system settings");
assert.match(androidMain,/20-minute invitation window/);
assert.doesNotMatch(androidMain,/30_000/,"Android does not end guest or Server calls after a local 30-second timer");
assert.doesNotMatch(androidMain,/EXTRA_PHONE_ACCOUNT_HANDLE|selectedCellularAccount/,
  "carrier fallback leaves SIM selection to Android and the user");
assert.ok(iosModel.includes("normalizePhoneForServer"),"iOS normalizes national-format contact numbers");
assert.match(androidMain,/deliveryMode == "manual_share"/);
assert.match(androidMain,/started\.optString\("invitation_text"/,"Android prefers the explicit manual-share invitation field from the backend");
assert.match(iosModel,/guestInviteMessage/);
assert.ok(iosView.includes("ShareLink(item: model.guestInviteMessage"));
assert.match(calls,/next_after_seq/);
assert.match(guest,/GUEST_INVITE_EXPIRED_OR_INVALID/);
assert.match(guest,/RTCPeerConnection|server_call_signals/);
const configCode=config.split("\n").filter(line=>!line.trim().startsWith("//")).join("\n");
assert.doesNotMatch(configCode,/service[_-]?role|sb_secret/i,"browser config contains no privileged key");
assert.match(config,/hzuovekqsjtpvmbuybxs\.supabase\.co/);
assert.doesNotMatch(app,/request_otp|verify_otp/);
assert.doesNotMatch(app,/server-handoff|server-auth/);
assert.doesNotMatch(app,/signInWithOtp|verifyOtp\(/);
assert.match(app,/server:\/\/device-setup/);
assert.match(guestWeb,/getUserMedia/);
assert.match(guestWeb,/RTCPeerConnection/);
assert.match(calls,/You do not need to install the Server app/,
  "non-Server invite explains that a recipient does not need the app");
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
  "launcherShowsServerIdFirstOnboardingWithoutSimPermissions",
  "guestCallInvitationNotificationOffersExplicitShareAndSmsActions",
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
assert.ok(androidEmulatorSmoke.includes("scripts/assert-android-test-count.py --expected-tests 14"),
  "the main API 34 emulator must execute all 14 acceptance tests without skips or failures");

for (const p of ["web/index.html","web/styles.css","web/terms.html","web/privacy.html","supabase/config.toml","supabase/functions/server-auth/index.ts","supabase/functions/server-handoff/index.ts","supabase/migrations/20261021124332_server_custom_phone_auth.sql","supabase/migrations/20261021195856_server_app_handoff.sql","supabase/migrations/20261022100500_server_device_first_identity.sql"]) assert.ok(existsSync(resolve(root,p)),"expected file "+p);
console.log("Server backend/web contract checks: PASS");
console.log("Checks include SIM-independent identity, OS permissions, consent-based number linking, Server-ID routing, legacy OTP safeguards, guest WebRTC and public-key hygiene.");
console.log("Static checks only; they do not prove real SIM SMS or connected call audio.");
