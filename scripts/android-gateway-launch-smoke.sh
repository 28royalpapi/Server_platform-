#!/usr/bin/env bash
set -euo pipefail

mkdir -p artifacts
APK="apps/android-caller/app/build/outputs/apk/debug/app-universal-debug.apk"
if [[ ! -s "$APK" ]]; then
  APK="$(find apps/android-caller/app/build/outputs/apk/debug -maxdepth 1 -type f -name '*.apk' ! -name '*androidTest*' | head -n1)"
fi
test -s "$APK"

echo "=== Emulator/device ==="
adb devices -l
adb shell getprop sys.boot_completed | grep -q '^1$'

echo "=== Wait for Android Package Manager readiness ==="
package_manager_ready=false
for attempt in $(seq 1 60); do
  if adb shell pm list packages >/dev/null 2>&1; then
    package_manager_ready=true
    break
  fi
  echo "Package Manager is not ready yet (attempt $attempt/60)."
  sleep 2
done
if [[ "$package_manager_ready" != true ]]; then
  adb logcat -d -t 1200 > artifacts/server-app-package-manager-logcat.txt 2>&1 || true
  echo "FAIL: Android Package Manager did not become available after boot." >&2
  exit 1
fi

echo "=== Install the one Server Android application ==="
timeout 120s adb install -r "$APK"
adb shell pm path com.server.caller.debug | grep -q '^package:'

echo "=== Verify the integrated SIM gateway is packaged in the Connector ==="
AAPT="$ANDROID_HOME/build-tools/35.0.0/aapt"
"$AAPT" dump xmltree "$APK" AndroidManifest.xml > artifacts/server-app-manifest.txt
grep -Fq 'com.server.caller.ServerSmsGatewayService' artifacts/server-app-manifest.txt
grep -Fq 'com.server.caller.ServerSmsStatusReceiver' artifacts/server-app-manifest.txt
if grep -Fq 'com.server.gateway' artifacts/server-app-manifest.txt; then
  echo "FAIL: the distributed Server APK contains the retired second-app package." >&2
  exit 1
fi

echo "=== Launch the real Server onboarding activity ==="
if ! timeout 60s adb shell am start -W -n com.server.caller.debug/com.server.caller.ServerSetupWebActivity > artifacts/server-app-am-start.txt 2>&1; then
  adb logcat -d -t 1000 > artifacts/server-app-launch-logcat.txt 2>&1 || true
  adb shell dumpsys activity activities > artifacts/server-app-activities.txt 2>&1 || true
  cat artifacts/server-app-am-start.txt >&2 || true
  exit 1
fi
cat artifacts/server-app-am-start.txt

sleep 3
adb shell dumpsys activity activities > artifacts/server-app-activities.txt 2>&1
if ! grep -Fq 'com.server.caller.ServerSetupWebActivity' artifacts/server-app-activities.txt; then
  adb logcat -d -t 1000 > artifacts/server-app-launch-logcat.txt 2>&1 || true
  adb shell dumpsys activity top > artifacts/server-app-activity-top.txt 2>&1 || true
  echo "FAIL: Server onboarding did not remain on the activity stack." >&2
  exit 1
fi

if ! timeout 30s adb exec-out screencap -p > artifacts/server-app-screen.png; then
  adb logcat -d -t 1000 > artifacts/server-app-launch-logcat.txt 2>&1 || true
  echo "FAIL: direct screenshot capture failed." >&2
  exit 1
fi
test -s artifacts/server-app-screen.png
adb logcat -d -t 500 > artifacts/server-app-launch-logcat.txt 2>&1 || true
echo "SERVER_SINGLE_APP_GATEWAY_SMOKE_PASS: one package installed, integrated SIM service declared, onboarding launched."
