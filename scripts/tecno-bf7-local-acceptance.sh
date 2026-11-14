#!/usr/bin/env bash
set -euo pipefail

# Run the existing Server Android instrumentation suite on the actual TECNO BF7.
# This uses the user's own handset over USB ADB; it does not use Firebase or cloud billing.

APP_APK="${APP_APK:-artifacts/physical/server-android-arm64-debug.apk}"
TEST_APK="${TEST_APK:-artifacts/physical/server-android-arm64-androidTest.apk}"
SERIAL="${ADB_SERIAL:-}"

if ! command -v adb >/dev/null 2>&1; then
  echo "ADB is missing. Install Android Platform Tools on this computer first." >&2
  exit 2
fi
if [[ ! -s "$APP_APK" || ! -s "$TEST_APK" ]]; then
  echo "Missing the ARM64 app/test pair. Download both files from the GitHub Actions artifact server-android-debug-apks." >&2
  echo "Expected: $APP_APK and $TEST_APK" >&2
  exit 2
fi

adb start-server >/dev/null
if [[ -z "$SERIAL" ]]; then
  mapfile -t DEVICES < <(adb devices | awk 'NR>1 && $2=="device" {print $1}')
  if [[ ${#DEVICES[@]} -ne 1 ]]; then
    echo "Expected exactly one authorized Android device. Found: ${#DEVICES[@]}." >&2
    echo "Connect only the TECNO BF7, accept its USB-debugging prompt, or set ADB_SERIAL explicitly." >&2
    adb devices -l >&2
    exit 2
  fi
  SERIAL="${DEVICES[0]}"
fi
ADB=(adb -s "$SERIAL")
if [[ "$(${ADB[@]} get-state 2>/dev/null || true)" != "device" ]]; then
  echo "The selected Android device is not authorized/ready. Unlock it and accept the USB-debugging prompt." >&2
  exit 2
fi

MANUFACTURER="$("${ADB[@]}" shell getprop ro.product.manufacturer | tr -d '\r')"
MODEL="$("${ADB[@]}" shell getprop ro.product.model | tr -d '\r')"
DEVICE="$("${ADB[@]}" shell getprop ro.product.device | tr -d '\r')"
SDK="$("${ADB[@]}" shell getprop ro.build.version.sdk | tr -d '\r')"
RELEASE="$("${ADB[@]}" shell getprop ro.build.version.release | tr -d '\r')"
ABI="$("${ADB[@]}" shell getprop ro.product.cpu.abi | tr -d '\r')"

printf 'Physical handset: %s %s (%s)\nAndroid: %s / API %s\nPrimary ABI: %s\n' "$MANUFACTURER" "$MODEL" "$DEVICE" "$RELEASE" "$SDK" "$ABI"

if [[ ! "$MANUFACTURER $MODEL $DEVICE" =~ [Tt][Ee][Cc][Nn][Oo] ]] || [[ ! "$MODEL $DEVICE" =~ [Bb][Ff]7 ]]; then
  echo "REFUSED: this does not identify as a TECNO BF7 handset. No APK installed." >&2
  exit 2
fi
if [[ "$ABI" != "arm64-v8a" ]]; then
  echo "REFUSED: expected arm64-v8a but device reports $ABI. No APK installed." >&2
  exit 2
fi
if [[ "$SDK" != "31" ]]; then
  echo "NOTICE: this is a BF7-family device but Android API is $SDK (the original A/B test target is API 31). The actual API will be recorded." >&2
fi

# Validate the app package's native ABI before installing it.
if ! unzip -l "$APP_APK" | grep 'lib/arm64-v8a/libjingle_peerconnection_so.so' >/dev/null; then
  echo "REFUSED: app APK does not contain ARM64 WebRTC." >&2
  exit 2
fi
if unzip -l "$APP_APK" | grep 'lib/x86_64/' >/dev/null; then
  echo "REFUSED: app APK contains emulator x86_64 libraries; use the ARM64 build." >&2
  exit 2
fi

mkdir -p artifacts/tecno-bf7
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="artifacts/tecno-bf7/bf7-instrumentation-$STAMP.txt"

echo "Installing Server ARM64 debug app and its matching instrumentation APK…"
"${ADB[@]}" install -r "$APP_APK"
"${ADB[@]}" install -r "$TEST_APK"

echo "Running the existing 14-test CallerSmokeTest suite on the physical handset…"
set +e
"${ADB[@]}" shell am instrument -w -r \
  -e class com.server.caller.CallerSmokeTest \
  com.server.caller.debug.test/androidx.test.runner.AndroidJUnitRunner 2>&1 | tee "$LOG"
RESULT=${PIPESTATUS[0]}
set -e
if [[ "$RESULT" -ne 0 ]]; then
  echo "FAIL: instrumentation process exited with $RESULT. See $LOG." >&2
  exit "$RESULT"
fi
if ! grep -E 'OK \(14 tests?\)' "$LOG" >/dev/null; then
  echo "FAIL: expected the exact 14-test summary. Inspect $LOG; no pass is claimed." >&2
  exit 1
fi

echo
echo "PHYSICAL_TECNO_BF7_INSTRUMENTATION_PASS: 14 tests, 0 failures reported by AndroidJUnitRunner."
echo "This is an OEM/OS instrumentation pass, not yet a real two-party audio pass."
echo "Next manual proof: create/sign into a second Server identity on another live endpoint; run the four call scenarios and verify two-way spoken audio."
echo "Do not treat this single-device test as proof that the other endpoint rang or that voice audio worked."
