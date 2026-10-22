#!/usr/bin/env bash
set -euo pipefail

mkdir -p artifacts
APK="apps/android-sim-gateway/app/build/outputs/apk/debug/app-debug.apk"

echo "=== Emulator/device ==="
adb devices -l
adb shell getprop sys.boot_completed | grep -q '^1$'

echo "=== Install the exact SIM gateway APK ==="
timeout 120s adb install -r "$APK"
adb shell pm path com.server.gateway.debug | grep -q '^package:'

echo "=== Launch the real gateway activity ==="
if ! timeout 60s adb shell am start -W -n com.server.gateway.debug/com.server.gateway.MainActivity > artifacts/server-gateway-am-start.txt 2>&1; then
  adb logcat -d -t 1000 > artifacts/server-gateway-launch-logcat.txt 2>&1 || true
  adb shell dumpsys activity activities > artifacts/server-gateway-activities.txt 2>&1 || true
  cat artifacts/server-gateway-am-start.txt >&2 || true
  exit 1
fi
cat artifacts/server-gateway-am-start.txt

sleep 3
adb shell dumpsys activity activities > artifacts/server-gateway-activities.txt 2>&1
if ! grep -Fq 'com.server.gateway.MainActivity' artifacts/server-gateway-activities.txt; then
  adb logcat -d -t 1000 > artifacts/server-gateway-launch-logcat.txt 2>&1 || true
  adb shell dumpsys activity top > artifacts/server-gateway-activity-top.txt 2>&1 || true
  echo "FAIL: Android accepted the start intent but MainActivity did not remain on the activity stack." >&2
  exit 1
fi

# Stream the screenshot directly over ADB instead of writing to the emulated
# shared-storage mount, which has intermittently dropped its transport in CI.
if ! timeout 30s adb exec-out screencap -p > artifacts/server-gateway-screen.png; then
  adb logcat -d -t 1000 > artifacts/server-gateway-launch-logcat.txt 2>&1 || true
  adb shell dumpsys meminfo > artifacts/server-gateway-meminfo.txt 2>&1 || true
  echo "FAIL: gateway activity was present, but direct screenshot capture failed; diagnostics saved." >&2
  exit 1
fi
test -s artifacts/server-gateway-screen.png
adb logcat -d -t 500 > artifacts/server-gateway-launch-logcat.txt 2>&1 || true
echo "GATEWAY_LAUNCH_SMOKE_PASS: package installed, launcher stayed in the foreground, screenshot captured over ADB."
