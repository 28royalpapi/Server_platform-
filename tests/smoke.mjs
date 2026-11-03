import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const root = process.cwd();
const read = (p) => readFileSync(resolve(root,p),"utf8");
const migration=read("supabase/migrations/20261021114947_server_backend_schema.sql");
const pushMigration=read("supabase/migrations/20261101175446_server_push_devices_and_call_expiry.sql");
const authMigration=read("supabase/migrations/20261021124332_server_custom_phone_auth.sql");
const handoffMigration=read("supabase/migrations/20261021195856_server_app_handoff.sql");
const deviceMigration=read("supabase/migrations/20261022100500_server_device_first_identity.sql");
const handoff=read("supabase/functions/server-handoff/index.ts");
const androidMain=read("apps/android-caller/app/src/main/java/com/server/caller/MainActivity.kt");
const androidSetup=read("apps/android-caller/app/src/main/java/com/server/caller/ServerSetupWebActivity.kt");
const androidTelecom=read("apps/android-caller/app/src/main/java/com/server/caller/ServerConnectionService.kt");
const androidEngine=read("apps/android-caller/app/src/main/java/com/server/caller/ServerTelecomCallEngine.kt");
const androidBuild=read("apps/android-caller/app/build.gradle.kts");
const androidCallNotifications=read("apps/android-caller/app/src/main/java/com/server/caller/ServerCallNotifications.kt");
const androidManifest=read("apps/android-caller/app/src/main/AndroidManifest.xml");
const androidTests=read("apps/android-caller/app/src/androidTest/java/com/server/caller/CallerSmokeTest.kt");
const nativeWorkflow=read(".github/workflows/build-server-native.yml");
const androidReaWorkflow=read(".github/workflows/server-rea-apk-audit.yml");
const androidEmulatorSmoke=read("scripts/android-emulator-smoke.sh");
const androidTestCountCheck=read("scripts/assert-android-test-count.py");
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
assert.match(calls,/\.select\("id,state,route,created_at,updated_at,expires_at"\)\.single\(\)/,
  "call creation responses must not include a callee phone number or internal user UUID");
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
assert.ok(androidReaWorkflow.includes("ServerTelecomCallEngine$onIceConnectionChange$1' invokeSuspend"),
  "compiled APK inspection must decode the actual generated coroutine that applies ICE connected state");
assert.match(androidReaWorkflow,/ServerTelecomCallEngine onIceConnectionChange/,
  "compiled APK inspection must verify the call engine's real ICE-connected state handling");
assert.doesNotMatch(androidReaWorkflow,/MainActivity startCall|MainActivity preparePeer|MainActivity handleSignal/,
  "the call-engine audit must not use the obsolete Activity WebRTC implementation");
assert.match(androidTests,/enablePhoneAccountWithTestShell/);
assert.match(nativeWorkflow,/api-level: 26/);
assert.match(nativeWorkflow,/api-level: 31/);
assert.match(nativeWorkflow,/api-level: '36'/);
assert.match(androidTests,/serverCallUsesInternetCapabilityWithoutCarrierValidationFalseNegatives/,
   "mobile-data connectivity gating has an Android instrumentation test that ignores captive-portal validation false negatives");
assert.match(androidTests,/Outgoing Telecom flow must wait for the Server backend result/,
   "the preinstalled Phone-app test verifies outgoing calls are not backgrounded before backend success or failure");
assert.match(androidTests,/launcherShowsServerIdFirstOnboardingWithoutSimPermissions/);
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
assert.match(androidTelecom,/override fun onDisconnect\(\) \{\s*setRingbackRequested\(false\)/,
  "system disconnect must stop any active Telecom ringback");
assert.match(androidTests,/preinstalledPhoneDialerOffersServerAsAnOutgoingCallChoice/);
assert.match(androidTests,/Intent\(Intent\.ACTION_DIAL, Uri\.parse\("tel:\+12025550101"\)\)/,
  "outgoing-call acceptance opens Android's real Phone dialer with a test target");
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
assert.doesNotMatch(calls,/server_rate_limit_allow|GUEST_INVITE_RATE_LIMITED/,
  "the pilot does not impose invitation quotas on callers or recipients");
assert.match(calls,/token_hash:tokenHash/,"guest invite links remain stored as token hashes");
assert.match(calls,/expires_at:expires/,"guest invite links remain time-limited for basic abuse protection");
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
assert.ok(!nativeWorkflow.includes("android12PhoneAccountCanReceiveServerCallThroughTelecom"),
  "Android 12 must not use the old nonexistent test method selector");
assert.ok(nativeWorkflow.includes("phoneAccountCanReceiveIncomingCallThroughTelecom"),
  "Android 12/16 Telecom acceptance must target an existing test method");
assert.ok(androidTests.includes("fun incomingServerCallPostsNativeCallStyleAlertWithRingtoneAndDndSettings"));
assert.ok(androidTests.includes("fun missedServerCallNotificationOffersQuietCallbackAction"));
assert.ok(androidEmulatorSmoke.includes("scripts/assert-android-test-count.py"),
  "the main emulator run must reject a zero-test result");

for (const p of ["web/index.html","web/styles.css","web/terms.html","web/privacy.html","supabase/config.toml","supabase/functions/server-auth/index.ts","supabase/functions/server-handoff/index.ts","supabase/migrations/20261021124332_server_custom_phone_auth.sql","supabase/migrations/20261021195856_server_app_handoff.sql","supabase/migrations/20261022100500_server_device_first_identity.sql"]) assert.ok(existsSync(resolve(root,p)),"expected file "+p);
console.log("Server backend/web contract checks: PASS");
console.log("Checks include SIM-independent identity, OS permissions, consent-based number linking, Server-ID routing, legacy OTP safeguards, guest WebRTC and public-key hygiene.");
console.log("Static checks only; they do not prove real SIM SMS or connected call audio.");
