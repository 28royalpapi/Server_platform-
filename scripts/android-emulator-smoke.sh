#!/usr/bin/env bash
set -euo pipefail

mkdir -p artifacts
echo "Waiting for the Android emulator to be online and fully booted"
READY=0
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
  echo "ADB attempt $attempt/60: state=${STATE:-missing} boot_completed=${BOOTED:-unknown}"
  adb reconnect offline >/dev/null 2>&1 || true
  sleep 5
done

if [[ "$READY" -ne 1 ]]; then
  adb devices -l || true
  adb logcat -d -t 500 > artifacts/server-android-boot-failure-logcat.txt 2>&1 || true
  exit 1
fi
adb devices -l

echo "Launching SIM Gateway UI and checking its project defaults"
adb shell am start -n com.server.gateway.debug/com.server.gateway.MainActivity
sleep 4
adb shell uiautomator dump /sdcard/server-gateway-ui.xml >/dev/null
adb pull /sdcard/server-gateway-ui.xml artifacts/server-gateway-ui.xml >/dev/null
grep -q 'hzuovekqsjtpvmbuybxs.supabase.co' artifacts/server-gateway-ui.xml
grep -q 'sb_publishable_denBmNsOLdaEYPjFr4JxTA_XgElA64E' artifacts/server-gateway-ui.xml
grep -q 'Pair this gateway' artifacts/server-gateway-ui.xml
echo "GATEWAY_UI_SMOKE_PASS: app opened with the dedicated Server backend defaults."

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
