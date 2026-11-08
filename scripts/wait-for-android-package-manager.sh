#!/usr/bin/env sh
set -eu

# Some AVDs briefly report "offline" while system_server and Package Manager boot.
adb start-server >/dev/null 2>&1 || true
attempt=0
while [ "$attempt" -lt 120 ]; do
  state="$(adb get-state 2>/dev/null || true)"
  if [ "$state" = "device" ]; then
    boot_completed="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
    package_service="$(adb shell service check package 2>/dev/null || true)"
    activity_service="$(adb shell service check activity 2>/dev/null || true)"
    if [ "$boot_completed" = "1" ] &&
       printf '%s' "$package_service" | grep -q 'found' &&
       printf '%s' "$activity_service" | grep -q 'found' &&
       adb shell cmd package list packages >/dev/null 2>&1 &&
       adb shell am get-current-user >/dev/null 2>&1; then
      echo "ANDROID_PACKAGE_MANAGER_READY: system boot, activity and package services are available."
      exit 0
    fi
    echo "ANDROID_PACKAGE_MANAGER_WAIT: boot=$boot_completed package=$package_service activity=$activity_service"
  else
    echo "ANDROID_ADB_WAIT: transport state=${state:-missing}"
    adb reconnect offline >/dev/null 2>&1 || true
    adb reconnect device >/dev/null 2>&1 || true
  fi
  attempt=$((attempt + 1))
  sleep 2
done

echo "ANDROID_PACKAGE_MANAGER_NOT_READY: emulator did not expose stable activity/package services." >&2
adb devices -l >&2 || true
adb shell getprop sys.boot_completed >&2 || true
adb shell service check package >&2 || true
adb shell service check activity >&2 || true
adb shell ps -A | grep -E 'system_server|package' >&2 || true
exit 1
