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
apk="apps/android-caller/app/build/outputs/apk/debug/app-universal-debug.apk"
if [ ! -s "$apk" ]; then
  echo "ERROR: Server debug APK is missing before Android 17 install validation."
  exit 1
fi

zipalign="$ANDROID_HOME/build-tools/36.0.0/zipalign"
if ! "$zipalign" -c -P 16 -v 4 "$apk"; then
  echo "ERROR: Android 17 APK ZIP/native-library alignment validation failed."
  exit 1
fi

if ! adb install -r "$apk"; then
  echo "ERROR: Package Manager rejected Server APK on the Android 17 16 KB-page emulator."
  adb logcat -d -b all | grep -Ei 'PackageManager|INSTALL_FAILED|lib|page|zip|avc' | tail -100 || true
  exit 1
fi

echo "ANDROID17_16KB_VALIDATION_PASS"
