#!/usr/bin/env sh
set -eu

# Emulator boot_completed can become 1 before the Package Manager binder service is
# ready, especially on preview/large-page images. Gradle's split APK installer calls
# package install-create, which fails with "Can't find service: package" in that window.
adb wait-for-device
attempt=0
while [ "$attempt" -lt 90 ]; do
  boot_completed="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  package_service="$(adb shell service check package 2>/dev/null || true)"
  if [ "$boot_completed" = "1" ] &&
     printf '%s' "$package_service" | grep -q 'found' &&
     adb shell cmd package list packages >/dev/null 2>&1; then
    echo "ANDROID_PACKAGE_MANAGER_READY: emulator package service is available."
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 2
done

echo "ANDROID_PACKAGE_MANAGER_NOT_READY: emulator boot completed without a usable package service." >&2
adb shell getprop sys.boot_completed >&2 || true
adb shell service check package >&2 || true
adb shell ps -A | grep -E 'system_server|package' >&2 || true
exit 1
