#!/bin/sh
set -eu

echo "ANDROID17_16KB_VALIDATION_START"
page_size="$(adb shell getconf PAGE_SIZE | tr -d '\r')"
echo "ANDROID17_PAGE_SIZE=$page_size"
if [ "$page_size" != "16384" ]; then
  echo "ERROR: API 37 emulator is not running with 16 KB pages."
  exit 1
fi

adb shell df -h /data
available_kb="$(adb shell df -Pk /data | awk 'NR > 1 {print $(NF-2); exit}' | tr -d '\r')"
case "$available_kb" in
  ''|*[!0-9]*) echo "ERROR: could not determine available /data storage."; exit 1 ;;
esac
echo "ANDROID17_DATA_AVAILABLE_KB=$available_kb"
if [ "$available_kb" -lt 1048576 ]; then
  echo "ERROR: Android 17 emulator has less than 1 GiB free in /data before app installation."
  exit 1
fi
apk="apps/android-caller/app/build/outputs/apk/debug/app-universal-debug.apk"
if [ ! -s "$apk" ]; then
  echo "ERROR: Server debug APK is missing before Android 17 install validation."
  exit 1
fi

zipalign="$(find "$ANDROID_HOME/build-tools" -maxdepth 2 -type f -name zipalign | sort -V | tail -n 1)"
if [ -z "$zipalign" ] || [ ! -x "$zipalign" ]; then
  echo "ERROR: no Android Build Tools zipalign executable was found."
  exit 1
fi
echo "ANDROID17_ZIPALIGN=$zipalign"
if ! "$zipalign" -c -P 16 -v 4 "$apk"; then
  echo "ERROR: Android 17 APK ZIP/native-library alignment validation failed."
  exit 1
fi

# Use non-streaming install on the 16 KB emulator: ADB first pushes the APK,
# then invokes Package Manager separately. This avoids the streaming install path
# that previously lost the Package Manager binder connection mid-transfer.
installed=0
attempt=1
while [ "$attempt" -le 3 ]; do
  echo "ANDROID17_INSTALL_ATTEMPT=$attempt"
  sh scripts/wait-for-android-package-manager.sh
  sleep 3
  if adb install -r --no-streaming "$apk" &&
     adb shell pm path com.server.caller.debug | grep -q '^package:'; then
    installed=1
    break
  fi

  echo "ANDROID17_INSTALL_RETRY_REQUIRED: attempt $attempt" >&2
  adb logcat -d -b all | grep -Ei 'PackageManager|PackageInstaller|INSTALL_FAILED|system_server|lib|page|zip|avc' | tail -100 || true
  adb reconnect offline >/dev/null 2>&1 || true
  timeout 45s adb wait-for-device || true
  attempt=$((attempt + 1))
  if [ "$attempt" -le 3 ]; then sleep 5; fi
done

if [ "$installed" -ne 1 ]; then
  echo "ERROR: Server APK could not be installed and verified on the Android 17 16 KB-page emulator."
  adb devices -l || true
  adb shell service check package || true
  adb logcat -d -b all | grep -Ei 'PackageManager|PackageInstaller|INSTALL_FAILED|system_server|lib|page|zip|avc' | tail -150 || true
  exit 1
fi

echo "ANDROID17_APK_INSTALL_PASS: package com.server.caller.debug is installed."
echo "ANDROID17_16KB_VALIDATION_PASS"
