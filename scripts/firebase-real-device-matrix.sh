#!/usr/bin/env bash
set -euo pipefail

# Six physical Firebase Test Lab handsets, in the requested A/B manufacturer pairs.
# Free Spark quota is five physical-device runs per project/day: batch 1 runs five;
# batch 2 runs the sixth after the daily quota resets.

BATCH="${1:-}"
PROJECT_ID="${FIREBASE_TEST_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
APP_APK="${APP_APK:-apps/android-caller/app/build/outputs/apk/debug/app-universal-debug.apk}"
TEST_APK="${TEST_APK:-apps/android-caller/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk}"

if [[ "$BATCH" != "1" && "$BATCH" != "2" ]]; then
  echo "Usage: $0 1|2" >&2
  exit 2
fi
if [[ -z "$PROJECT_ID" || "$PROJECT_ID" == "(unset)" ]]; then
  echo "FIREBASE_TEST_PROJECT_ID is unset. Select a Firebase project on the Spark plan first." >&2
  exit 2
fi
if ! command -v gcloud >/dev/null 2>&1; then
  echo "Google Cloud CLI (gcloud) is required. Install it and run 'gcloud auth login' first." >&2
  exit 2
fi
if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .; then
  echo "No active gcloud account. Run 'gcloud auth login' first." >&2
  exit 2
fi

gradle -p apps/android-caller assembleDebug assembleDebugAndroidTest --no-daemon --console=plain
test -s "$APP_APK"
test -s "$TEST_APK"

# Fail before consuming a physical-device run if any requested model has left
# the current Firebase Test Lab catalog. Device/version availability can change.
if [[ "$BATCH" == "1" ]]; then
  for model in TECNO-BF7 TECNO-BG6 a10 SC-51C bluejay; do
    gcloud firebase test android models describe "$model" --format=json >/dev/null
  done
else
  gcloud firebase test android models describe shiba --format=json >/dev/null
fi

COMMON_ARGS=(
  firebase test android run
  --project="$PROJECT_ID"
  --type=instrumentation
  --app="$APP_APK"
  --test="$TEST_APK"
  --timeout=20m
)

if [[ "$BATCH" == "1" ]]; then
  echo "REAL_DEVICE_BATCH=1 (five physical handsets)"
  echo "TECNO A: BF7 / Android 12; TECNO B: SPARK Go 2024 / Android 13"
  echo "Samsung A: Galaxy A10 / Android 10; Samsung B: Galaxy S22 / Android 16"
  echo "Google A: Pixel 6a / Android 12L"
  gcloud "${COMMON_ARGS[@]}" \
    --device model=TECNO-BF7,version=31,locale=en,orientation=portrait \
    --device model=TECNO-BG6,version=33,locale=en,orientation=portrait \
    --device model=a10,version=29,locale=en,orientation=portrait \
    --device model=SC-51C,version=36,locale=en,orientation=portrait \
    --device model=bluejay,version=32,locale=en,orientation=portrait
else
  echo "REAL_DEVICE_BATCH=2 (sixth physical handset; run after Spark quota reset)"
  echo "Google B: Pixel 8 / Android 15"
  gcloud "${COMMON_ARGS[@]}" \
    --device model=shiba,version=35,locale=en,orientation=portrait
fi
