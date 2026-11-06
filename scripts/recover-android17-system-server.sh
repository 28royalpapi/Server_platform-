#!/usr/bin/env sh
set -eu

# Infrastructure-only recovery for the Android 17 16 KB emulator. A reboot
# does not count as a test pass; the 14 instrumentation tests must still run.
services_ready() {
  boot="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  activity="$(adb shell service check activity 2>/dev/null || true)"
  package="$(adb shell service check package 2>/dev/null || true)"
  [ "$boot" = "1" ] &&
    printf '%s' "$activity" | grep -q 'found' &&
    printf '%s' "$package" | grep -q 'found' &&
    adb shell cmd package list packages >/dev/null 2>&1 &&
    adb shell am get-current-user >/dev/null 2>&1
}

attempt=0
while [ "$attempt" -lt 20 ]; do
  if services_ready; then
    echo "ANDROID17_SYSTEM_SERVER_READY: activity and package services are available."
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 2
done

echo "ANDROID17_SYSTEM_SERVER_RECOVERY: rebooting emulator once after binder service loss."
adb reboot >/dev/null 2>&1 || adb shell reboot >/dev/null 2>&1 || true
adb wait-for-device

attempt=0
while [ "$attempt" -lt 120 ]; do
  if services_ready; then
    sh scripts/unlock-android-emulator.sh
    if ! adb shell pm path com.server.caller.debug 2>/dev/null | grep -q '^package:'; then
      echo "ANDROID17_SYSTEM_SERVER_RECOVERY_FAILED: Server app was not preserved after reboot." >&2
      exit 1
    fi
    echo "ANDROID17_SYSTEM_SERVER_RECOVERY_PASS: emulator rebooted and retained the installed 16 KB Server APK."
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 2
done

echo "ANDROID17_SYSTEM_SERVER_RECOVERY_FAILED: activity/package services did not recover." >&2
adb shell getprop sys.boot_completed >&2 || true
adb shell service check activity >&2 || true
adb shell service check package >&2 || true
adb shell ps -A | grep -E 'system_server|package' >&2 || true
exit 1
