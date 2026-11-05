# Server Android physical-device validation

## Six-device handset matrix

The requested A/B pairing is represented by six **physical Firebase Test Lab catalog devices**. These are not Android Studio AVD skins. TECNO A deliberately uses the TECNO-BF7 model family (Android 12/API 31), matching the user's current TECNO BF7 class; TECNO B moves to the SPARK Go 2024 on Android 13/API 33.

| Class | A device | A Android | B device | B Android |
|---|---|---:|---|---:|
| TECNO | TECNO BF7 (TECNO-BF7) | 12 / API 31 | TECNO SPARK Go 2024 (TECNO-BG6) | 13 / API 33 |
| Samsung | Galaxy A10 (a10) | 10 / API 29 | Galaxy S22 (SC-51C) | 16 / API 36 |
| Google Pixel | Pixel 6a (bluejay) | 12L / API 32 | Pixel 8 (shiba) | 15 / API 35 |

The Firebase device catalog is dynamic. Confirm the model IDs and OS versions are still available in the console before treating a run as scheduled.

## Important: choose the no-billing device route

Use **Firebase Test Lab on the Spark plan** for the six automated handset runs. The current no-cost quota is five physical-device test runs per project per day, so batch 1 uses five devices and batch 2 uses the sixth after the quota resets. Do not attach a billing account or upgrade this dedicated test project to Blaze.

Firebase Test Lab is scheduled for shutdown on 30 September 2027, but it remains the appropriate no-billing route for this immediate validation. Plan a migration later rather than switching this test to the newer Developer Device Platform now: its public-preview physical Device Run pricing is usage-based and is not a no-cost replacement.

Android Device Streaming's Spark allowance is 30 minutes per project per month. However, Google states that Partner Device Lab streaming generally follows standard pricing unless a device is specifically marked otherwise. Do not start a TECNO/Samsung partner streaming session unless the console clearly confirms it is free. For this six-device acceptance run, use Test Lab's Spark physical-test quota instead.

Firebase is a web console/service, not an Android app that must be installed on the TECNO phone. The physical test devices are hosted in Google's lab; they install and run the supplied APKs during the test.

## Run the tests from the Firebase console (no local Firebase app required)

1. Create a separate Firebase project for Server device testing and keep it on the **Spark** plan. Do not add a billing account.
2. Open **DevOps & Engagement → Test Lab → Run a test → Instrumentation**.
3. Upload the Server **debug app APK** and its matching **androidTest APK** from the GitHub Actions artifact named `server-android-debug-apks`.
4. On the device selection screen, choose the five physical models listed in batch 1 above, then start the test.
5. On the next Spark quota day, repeat for the Pixel 8 (batch 2).
6. Save the Firebase Test Lab matrix links and per-device test reports. A device passes only with the full 14/14 test count and zero failures, errors or skips.

The console flow avoids installing Google Cloud CLI on the user's computer. The existing `scripts/firebase-real-device-matrix.sh` remains available for authenticated command-line runs.

## Run the six physical-device acceptance tests

Prerequisites:
- A Firebase project on the **Spark (no-cost) plan**. Do not attach a billing account or switch to Blaze for this test.
- Google Cloud CLI installed.
- An account with permission to use Firebase Test Lab in that project.

Then run:

```sh
gcloud auth login
gcloud config set project YOUR_FIREBASE_PROJECT_ID
bash scripts/firebase-real-device-matrix.sh 1
```

Batch 1 contains five physical device runs and uses the published Spark quota of five physical runs per project per day. After the project's daily quota resets, run:

```sh
bash scripts/firebase-real-device-matrix.sh 2
```

Batch 2 runs the sixth physical device. Each device executes the unchanged 14-test CallerSmokeTest instrumentation suite. Count a device as passed only when its actual test report says: tests=14, failures=0, errors=0, skipped=0.

## SIM and two-party audio limits

This physical-device matrix validates the OEM handset, Android build, onboarding and Telecom integration. It does **not** provision a carrier SIM or eSIM, does not give the handset a routable telephone number, and does not itself complete a paired two-handset voice call.

An actual eSIM profile must be issued by a carrier or an authorized test operator and provisioned to a compatible device's eUICC. A GitHub project cannot mint a live carrier subscription. Server can also be tested SIM-free by using the two Server IDs created during onboarding.

The Android emulator's built-in GSM modem can simulate cellular call state, but Android's documentation says those simulated cellular calls do not support call audio. That is not a substitute for a real carrier SIM or a real Server/WebRTC voice conversation.

## Two-party voice acceptance gate

After the six single-device runs:
1. Provision two independent Server test accounts (one per physical handset).
2. Complete website onboarding on both devices and save the other account/contact.
3. Verify that each handset can ring the other through the Server backend.
4. Answer on B; verify microphone audio A-to-B and B-to-A, not merely a connected Telecom UI.
5. Repeat B-to-A, then test reject, hang-up, screen-locked incoming call and recovery after network loss.

This final gate requires two simultaneously available handsets and test accounts. Firebase Test Lab's single-device instrumentation runs do not, by themselves, constitute a paired conversation.

## Reference material

- Firebase Test Lab available devices: https://firebase.google.com/docs/test-lab/android/available-testing-devices
- Firebase Test Lab no-cost quotas and pricing: https://firebase.google.com/docs/test-lab/usage-quotas-pricing
- Android emulator telephony emulation: https://developer.android.com/studio/run/emulator-console
- Samsung Remote Test Lab: https://developer.samsung.com/remote-test-lab
