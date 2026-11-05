# Server first physical-device acceptance: TECNO BF7

## Purpose

This is the first real-handset gate. It deliberately starts with one TECNO device instead of trying to run six OEM models before a genuine phone has been tested.

The requested first target is the TECNO BF7 family. The Firebase Test Lab catalogue identifier previously found for that model family is `TECNO-BF7`, Android 12 / API 31. Test Lab's catalogue changes, so check the current console or run the script's model preflight before counting on that exact model/OS combination.

## No-cost device route

Use Firebase Test Lab on the **Spark plan**. The current published Spark quota allows five physical-device test runs per project per day. Do not attach a billing account or upgrade the project to Blaze. This test uses one physical-device run.

Firebase is a cloud console/service. It is not an Android APK that needs to be installed on the TECNO phone. Google hosts the test handset; Test Lab installs the submitted APKs in its lab.

The physical package must be the ARM64 debug app **and the matching ARM64 instrumentation APK**. The emulator-only x86_64 package cannot run on a physical BF7. The latest Android workflow now builds and uploads both pairs separately:
- `artifacts/physical/server-android-arm64-debug.apk`
- `artifacts/physical/server-android-arm64-androidTest.apk`
- `artifacts/physical/server-android-x86_64-debug.apk`
- `artifacts/physical/server-android-x86_64-androidTest.apk`

Do not substitute a release APK for the debug APK: the instrumentation APK is compiled against the debug application ID and must be paired with the matching debug app.

## Billing caveat — do not upgrade for Server testing

Google's current public documentation is inconsistent on the exact Spark prerequisite: the Test Lab quota/pricing and troubleshooting pages list a no-cost Spark quota of five physical test runs per day, but the Firebase Console quickstart says a project must be on Blaze (billing account linked) before running tests in the console.

Because this project must not incur charges, **do not attach a billing account and do not upgrade to Blaze just to test Server**. Only attempt Test Lab if the console or CLI accepts the existing Spark project and clearly shows the test will consume the Spark no-cost quota. If it asks you to link billing or upgrade to Blaze, cancel and stop. The script's Spark guard only prevents knowingly selecting a paid plan; it cannot override Google's service-side entitlement checks.

For the TECNO BF7 specifically, Android Device Streaming is not a guaranteed free fallback: Google provides 30 no-cost minutes per Spark project each month, but Partner Device Lab devices normally follow standard streaming pricing unless a device is explicitly marked exempt. Do not start a TECNO partner stream unless the console clearly identifies it as free.

The reliable no-subscription, no-billing route is to test on a physical handset that we already own (your TECNO BF7) using local ADB from an authorized computer, or use any borrowed handset directly. That does not require Firebase Test Lab. Remote Test Lab is optional, not a blocker to real-device testing.

Reference links:
- [Firebase Test Lab console quickstart](https://firebase.google.com/docs/test-lab/android/firebase-console)
- [Test Lab usage, quotas and pricing](https://firebase.google.com/docs/test-lab/usage-quotas-pricing)
- [Test Lab troubleshooting FAQ](https://firebase.google.com/docs/test-lab/troubleshooting)
- [Android Device Streaming and partner-device pricing note](https://developer.android.com/studio/run/android-device-streaming)

## Start one TECNO physical run

1. Create or select a dedicated Firebase project for Server device testing. Keep it on Spark and do not add a billing account.
2. In Firebase Console, open **DevOps & Engagement → Test Lab → Run a test → Instrumentation**.
3. Upload the ARM64 debug app APK and its matching ARM64 androidTest APK from the GitHub Actions artifact named `server-android-debug-apks`.
4. Select the physical TECNO BF7 / Android 12 (API 31) device, if it is still present in the current catalogue.
5. Run the instrumentation suite once. Save the Test Lab result URL and test report.

Alternatively, after downloading the artifact and installing Google Cloud CLI, authenticate with `gcloud auth login`, set `FIREBASE_TEST_PROJECT_ID`, and run:

```bash
export FIREBASE_SPARK_CONFIRMED=YES
export FIREBASE_TEST_PROJECT_ID='your-dedicated-firebase-project-id'
bash scripts/firebase-tecno-first-run.sh
```

Only set the Spark confirmation after independently checking the project's billing plan. The script refuses to run without this explicit guard and checks that the app APK contains ARM64 WebRTC code before it consumes a physical test run.

A handset OS-compatibility pass is only: **14 tests, 0 failures, 0 errors, 0 skipped**, reported by that physical device's test report. It does not prove a real call or two-way audio.

## Four call scenarios: expected behavior and current proof

| Scenario | What Server must do | What the current architecture does | Evidence / status |
|---|---|---|---|
| Server caller → Server recipient, recipient online | Recipient should ring through Telecom; answering should establish two-way WebRTC audio; caller should hear ringback while the recipient is being alerted | Routes as `server` when a Server ID is selected, or when a phone number is verified and the callee opted into number-based Server calls. Android requests system ringback for this route. Incoming delivery currently depends on an active listener or configured/registered push | **Not proven end-to-end.** The live push-device table is empty, FCM client/server configuration was reported missing in the last CI build, and no Server-to-Server call appears in the recent live call records |
| Server caller → Server recipient, recipient offline | Do not claim the call can ring without internet. The call may become missed and be visible after the recipient reconnects | Server call records expire after 180 seconds. FCM cannot wake a device that has no internet connection | **No immediate offline ring.** Missed-call recovery after reconnection still needs a physical TECNO check |
| Server caller → non-Server recipient, recipient online | Caller shares a secure guest link; recipient opens it in a browser, taps Answer, grants microphone permission and stays online; two-way WebRTC audio should then connect | Backend creates a hashed, one-call guest invitation valid for 20 minutes and returns a manual-share link. Guest browser page implements join, microphone capture, WebRTC offer/answer/ICE and hang-up. It is not an ordinary cellular call and does not auto-send SMS | **Implemented but not proven live.** The last 30 days show 13 guest calls, all missed; all 13 invitations expired and zero were joined |
| Server caller → non-Server recipient, recipient offline | No Server internet call can ring that recipient. A link cannot be opened while offline | The guest URL requires the recipient to get online and open it. There is no automatic SMS or PSTN/SIP carrier termination in this build | **Not supported as an offline ring.** Requires a real carrier/wholesale voice route or another recipient-reachable alert channel |

### Ringback, ringtone and vibration

- Android's Telecom connection requests system ringback for the direct Server-to-Server route. The guest route does not request normal ringback because the recipient has not been rung; the caller has a manual invitation to share.
- Incoming Android calls use the system ringtone/vibration notification channel and should respect the user's notification, sound, vibration and Do Not Disturb settings. This still needs a physical TECNO check.
- A normal carrier voice call is not redirected to Server merely because a phone number was verified.

## Why the 14/14 emulator result was not enough

The recent Android instrumentation suite contains 14 tests. Some check international number formatting, notification construction, permissions and Telecom state. Its incoming-call tests inject synthetic call IDs into Telecom. Its outgoing system dialer test uses a deliberately invalid Server session token and expects the backend request to be rejected after it reaches the call engine.

Those are useful OS-integration tests, but they do not establish that two people completed a call or heard one another. The API 31 emulator report was 14/14; API 33 and API 37 jobs in the last native workflow failed during emulator startup/ADB communication before a full instrumentation report was produced.

## The next real voice test after the TECNO handset passes

A single physical handset can validate installation, permissions, Telecom account registration, real TECNO notifications and the physical OEM behavior. It cannot, by itself, prove both ends of a live conversation.

For the first actual audio proof, use:
- the physical TECNO as the Server caller; and
- a second live endpoint for the recipient (a second Server-enabled phone for the Server-to-Server scenario, or a separate laptop/phone browser for the guest scenario).

For each completed call, save evidence of the call record changing from ringing/connecting to active, the recipient's answer action, two-way spoken audio, and clean hang-up. A Telecom screen appearing or an FCM send returning success is not an audio pass.

## Live backend baseline recorded on 5 November 2026

Read-only checks on the correct Supabase project, **Server Backend** (`hzuovekqsjtpvmbuybxs`), established:
- `allow_number_based_server_calls` exists as `boolean NOT NULL DEFAULT false`.
- Six Server profiles exist; one has a verified phone number; zero have opted into number-based incoming calls.
- `server_push_devices` currently has no registered device endpoints.
- In the prior 30 days, there were 13 guest-route call records, all marked missed; there were 13 guest invitations, zero joined and 13 expired.
- There were no Server-route call records in that 30-day aggregate.

These are aggregate counts only; no phone numbers, push tokens or secrets were read or exposed.

## Release status

This physical test has **not** yet been run. A successful GitHub build is not proof that a physical TECNO passed. Keep PR #5 as draft until the ARM64 artifact is built, the BF7 Test Lab report is captured, and the real two-party audio scenarios have been exercised.
