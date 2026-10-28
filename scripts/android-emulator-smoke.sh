#!/usr/bin/env bash
set -euo pipefail

mkdir -p artifacts
# macOS provides GNU timeout as gtimeout when coreutils is installed; Linux uses timeout.
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN=timeout
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN=gtimeout
else
  echo "Neither timeout nor gtimeout is installed; refusing to run unbounded tests." >&2
  exit 1
fi

echo "Waiting for the Android emulator to be online and fully booted"
READY=0
# The emulator action already waits for boot. Keep this second ADB
# readiness guard short so a broken emulator fails with diagnostics promptly.
for attempt in $(seq 1 60); do
  STATE="$(adb get-state 2>/dev/null || true)"
  BOOTED=""
  if [[ "$STATE" == "device" ]]; then
    BOOTED="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  fi
  if [[ "$STATE" == "device" && "$BOOTED" == "1" ]]; then
    READY=1
    break
  fi
  echo "ADB attempt $attempt/240: state=${STATE:-missing} boot_completed=${BOOTED:-unknown}"
  adb reconnect offline >/dev/null 2>&1 || true
  sleep 3
done

if [[ "$READY" -ne 1 ]]; then
  adb devices -l || true
  adb logcat -d -t 500 > artifacts/server-android-boot-failure-logcat.txt 2>&1 || true
  exit 1
fi
adb devices -l

echo "Unlocking and foregrounding the Android emulator before instrumentation tests"
adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
adb shell input keyevent 82 >/dev/null 2>&1 || true
adb shell input keyevent 3 >/dev/null 2>&1 || true
sleep 2
adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' || true

echo "Configuring the emulator's simulated cellular modem and test phone number"
adb emu gsm voice on >/dev/null 2>&1 || true
adb emu gsm data on >/dev/null 2>&1 || true
adb emu phonenumber 15550001001 >/dev/null 2>&1 || true
adb shell dumpsys isub > artifacts/server-emulator-subscriptions.txt 2>&1 || true

echo "Running Server website onboarding and system calling-account Android instrumentation tests"
TEST_STATUS=0
$TIMEOUT_BIN 600s gradle -p apps/android-caller connectedDebugAndroidTest --no-daemon || TEST_STATUS=$?
# Preserve Android diagnostics if an acceptance assertion fails.
adb logcat -d -t 12000 > artifacts/server-android-tests-logcat.txt 2>&1 || true
adb shell dumpsys telecom > artifacts/server-android-tests-telecom.txt 2>&1 || true
adb shell dumpsys activity activities > artifacts/server-android-tests-activities.txt 2>&1 || true
if [[ "$TEST_STATUS" -ne 0 ]]; then
  echo "Android instrumentation acceptance tests failed with exit code $TEST_STATUS."
  exit "$TEST_STATUS"
fi

echo "Recording the website setup bridge after Android system-call tests"
adb shell screenrecord --time-limit 18 /sdcard/server-android-launch.mp4 &
REC_PID=$!
cleanup_recorder() {
  kill -INT "$REC_PID" 2>/dev/null || true
  wait "$REC_PID" 2>/dev/null || true
}
trap cleanup_recorder EXIT
sleep 2
# Resolve and open the actual launcher Activity for the debug applicationId.
# The Activity class lives in the source package, but Android installs with the
# ".debug" applicationId suffix, so an explicit component can fail with Error type 3.
if ! $TIMEOUT_BIN 45s adb shell monkey -p com.server.caller.debug -c android.intent.category.LAUNCHER 1; then
  adb logcat -d -t 800 > artifacts/server-setup-launch-logcat.txt 2>&1 || true
  adb shell pm list packages | grep -E 'com\\.server\\.caller' > artifacts/server-installed-packages.txt || true
  echo "Could not launch Server's actual website-onboarding launcher Activity." >&2
  exit 1
fi
sleep 2
adb shell dumpsys activity activities > artifacts/server-setup-launch-activities.txt 2>&1 || true
if ! grep -Fq 'com.server.caller.debug' artifacts/server-setup-launch-activities.txt; then
  adb logcat -d -t 800 > artifacts/server-setup-launch-logcat.txt 2>&1 || true
  echo "Server website-onboarding Activity did not appear in the Android activity stack." >&2
  exit 1
fi
wait "$REC_PID" || true
trap - EXIT
adb pull /sdcard/server-android-launch.mp4 artifacts/server-android-startup.mp4 >/dev/null
echo "ANDROID_UI_SMOKE_PASS: website onboarding and system calling-account tests passed and setup recording captured."

echo "Installing the SIM Gateway APK onto the emulator before launching it"
$TIMEOUT_BIN 90s adb install -r apps/android-sim-gateway/app/build/outputs/apk/debug/app-debug.apk
adb shell pm path com.server.gateway.debug | grep -q 'package:'
echo "Launching SIM Gateway UI and checking its project defaults"
# Resolve the installed launchable activity through Android rather than hard-coding
# the applicationId/class pairing. The debug applicationId suffix can make an
# explicit component name fail even when the APK is installed and its manifest is valid.
if ! $TIMEOUT_BIN 45s adb shell monkey -p com.server.gateway.debug -c android.intent.category.LAUNCHER 1; then
  adb logcat -d -t 400 > artifacts/server-gateway-launch-logcat.txt 2>&1 || true
  adb shell pm list packages | grep -E 'com\.server\.gateway|com\.server\.caller' > artifacts/server-installed-packages.txt || true
  exit 1
fi
sleep 3
adb shell dumpsys activity activities > artifacts/server-gateway-activity.txt 2>&1 || true
if ! grep -Fq 'com.server.gateway' artifacts/server-gateway-activity.txt; then
  adb logcat -d -t 800 > artifacts/server-gateway-launch-logcat.txt 2>&1 || true
  adb shell dumpsys activity top > artifacts/server-gateway-activity-top.txt 2>&1 || true
  adb shell dumpsys window > artifacts/server-gateway-window.txt 2>&1 || true
  echo "Gateway launch returned, but no Server gateway activity was found in the Android activity stack." >&2
  exit 1
fi
# Stream pixels directly over ADB. Writing under /sdcard can break if the
# emulator's emulated-storage mount drops its transport during startup.
if ! $TIMEOUT_BIN 30s adb exec-out screencap -p > artifacts/server-gateway-screen.png; then
  adb logcat -d -t 1000 > artifacts/server-gateway-screencap-logcat.txt 2>&1 || true
  adb shell dumpsys meminfo > artifacts/server-gateway-screencap-meminfo.txt 2>&1 || true
  echo "Gateway launch was requested, but screenshot capture failed; diagnostics were saved." >&2
  exit 1
fi
test -s artifacts/server-gateway-screen.png
echo "GATEWAY_LAUNCH_SMOKE_PASS: explicit launcher activity is in the activity stack and a screenshot was streamed over ADB."

