# Server Android physical-device validation

## Six-device handset matrix

The requested A/B pairing is represented by six **physical Firebase Test Lab catalog devices**. These are not Android Studio AVD skins.

| Class | A device | A Android | B device | B Android |
|---|---|---:|---|---:|
| TECNO | TECNO POP 7 (TECNO-BF6) | 12 / API 31 | TECNO SPARK Go 2024 (TECNO-BG6) | 13 / API 33 |
| Samsung | Galaxy A10 (a10) | 10 / API 29 | Galaxy S22 (SC-51C) | 16 / API 36 |
| Google Pixel | Pixel 6a (bluejay) | 12L / API 32 | Pixel 8 (shiba) | 15 / API 35 |

The Firebase device catalog is dynamic. Confirm the model IDs and OS versions are still available in the console before treating a run as scheduled.

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
