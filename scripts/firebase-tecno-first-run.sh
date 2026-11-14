#!/usr/bin/env bash
set -euo pipefail

# First physical handset acceptance: TECNO BF7, Android 12 / API 31.
# This script intentionally refuses to run unless the operator explicitly
# confirms the selected Firebase project is on the no-billing Spark plan.

PROJECT_ID="${FIREBASE_TEST_PROJECT_ID:-}"
APP_APK="${APP_APK:-artifacts/physical/server-android-arm64-debug.apk}"
TEST_APK="${TEST_APK:-artifacts/physical/server-android-arm64-androidTest.apk}"

if [[ "${FIREBASE_SPARK_CONFIRMED:-}" != "YES" ]]; then
  echo "REFUSED: set FIREBASE_SPARK_CONFIRMED=YES only after confirming this Firebase project is on Spark and has no billing account." >&2
  exit 2
fi
if [[ -z "$PROJECT_ID" ]]; then
  echo "FIREBASE_TEST_PROJECT_ID is required. Do not guess the Firebase project ID." >&2
  exit 2
fi
if ! command -v gcloud >/dev/null 2>&1; then
  echo "Google Cloud CLI is required. Install it, then run 'gcloud auth login'." >&2
  exit 2
fi
if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .; then
  echo "No active Google Cloud account. Run 'gcloud auth login' first." >&2
  exit 2
fi
if [[ ! -s "$APP_APK" || ! -s "$TEST_APK" ]]; then
  echo "Missing ARM64 physical-device APK pair. Download the latest server-android-debug-apks GitHub artifact from the successful android-finish workflow." >&2
  echo "Expected: $APP_APK and $TEST_APK" >&2
  exit 2
fi

# Confirm the package really contains ARM64 WebRTC code and no emulator-only
# x86_64 libraries before spending the one physical-device test run.
if ! unzip -l "$APP_APK" | grep -q 'lib/arm64-v8a/libjingle_peerconnection_so.so'; then
  echo "REFUSED: app APK does not contain the ARM64 WebRTC native library." >&2
  exit 2
fi
if unzip -l "$APP_APK" | grep -q 'lib/x86_64/'; then
  echo "REFUSED: this is not the dedicated ARM64 physical-device APK." >&2
  exit 2
fi

echo "Checking that TECNO-BF7 / API 31 is currently listed before consuming a Test Lab run."
gcloud firebase test android models describe TECNO-BF7 --project="$PROJECT_ID" --format=json >/dev/null

echo "Starting ONE physical Firebase Test Lab run: TECNO BF7, Android 12 (API 31)."
echo "No billing account should be attached. Stop now if the project is not Spark."
gcloud firebase test android run \
  --project="$PROJECT_ID" \
  --type=instrumentation \
  --app="$APP_APK" \
  --test="$TEST_APK" \
  --device model=TECNO-BF7,version=31,locale=en,orientation=portrait \
  --timeout=20m \
  --num-flaky-test-attempts=0

echo "TEST LAB RUN FINISHED. Inspect its result URL and XML test report."
echo "A local OS-compatibility pass requires exactly 14 tests, 0 failures, 0 errors and 0 skipped."
echo "This is not a two-phone voice/audio pass; that requires a second live endpoint."
