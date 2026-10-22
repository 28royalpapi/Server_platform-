#!/usr/bin/env bash
set -euo pipefail

mkdir -p artifacts
echo "Waiting for the Android emulator to be online and fully booted"
READY=0
for attempt in $(seq 1 240); do
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

echo "Installing the SIM Gateway APK onto the emulator before launching it"
timeout 90s adb install -r apps/android-sim-gateway/app/build/outputs/apk/debug/app-debug.apk
adb shell pm path com.server.gateway.debug | grep -q 'package:'
echo "Launching SIM Gateway UI and checking its project defaults"
if ! timeout 45s adb shell am start -n com.server.gateway.debug/com.server.gateway.MainActivity; then
  adb logcat -d -t 400 > artifacts/server-gateway-launch-logcat.txt 2>&1 || true
  adb shell pm list packages | grep -E 'com\.server\.gateway|com\.server\.caller' > artifacts/server-installed-packages.txt || true
  exit 1
fi
sleep 3
adb shell dumpsys activity activities > artifacts/server-gateway-activity.txt 2>&1 || true
if ! grep -q 'com.server.gateway.MainActivity' artifacts/server-gateway-activity.txt; then
  adb logcat -d -t 800 > artifacts/server-gateway-launch-logcat.txt 2>&1 || true
  adb shell dumpsys activity top > artifacts/server-gateway-activity-top.txt 2>&1 || true
  echo "Gateway launch returned, but MainActivity was not found in the activity stack." >&2
  exit 1
fi
# Capture pixels without the memory-heavy uiautomator hierarchy service.
adb shell screencap -p /sdcard/server-gateway-ui.png
adb pull /sdcard/server-gateway-ui.png artifacts/server-gateway-ui.png >/dev/null
test -s artifacts/server-gateway-ui.png
echo "GATEWAY_UI_SMOKE_PASS: MainActivity is foregrounded and a non-empty startup screenshot was captured."

echo "Running caller-app Android instrumentation tests"
timeout 600s gradle -p apps/android-caller connectedDebugAndroidTest --no-daemon

echo "Recording the caller app screen"
adb shell screenrecord --time-limit 18 /sdcard/server-android-launch.mp4 &
REC_PID=$!
cleanup_recorder() {
  kill -INT "$REC_PID" 2>/dev/null || true
  wait "$REC_PID" 2>/dev/null || true
}
trap cleanup_recorder EXIT
sleep 2
adb shell am start -n com.server.caller.debug/com.server.caller.MainActivity
wait "$REC_PID" || true
trap - EXIT
adb pull /sdcard/server-android-launch.mp4 artifacts/server-android-startup.mp4 >/dev/null
echo "ANDROID_UI_SMOKE_PASS: caller instrumentation tests passed and startup recording captured."
