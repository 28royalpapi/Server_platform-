#!/bin/sh
set -eu

echo "ANDROID_USER_UNLOCK_START"
adb wait-for-device

# API 37 can finish booting while user 0 is still RUNNING_LOCKED. Package
# Manager readiness does not imply credential-encrypted app storage is ready.
# Clean CI AVDs have no PIN/pattern, so unlock the primary user explicitly.
adb shell input keyevent 224 >/dev/null 2>&1 || true
adb shell am unlock-user 0 >/dev/null 2>&1 || true
adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
adb shell input keyevent 82 >/dev/null 2>&1 || true
# Some preview images report RUNNING_UNLOCKED before credential-encrypted
# storage is actually available to app processes. Explicitly dismiss a
# swipe-only keyguard and query UserManager's unlocked state as well.
adb shell input touchscreen swipe 540 1800 540 300 250 >/dev/null 2>&1 || true
adb shell wm dismiss-keyguard >/dev/null 2>&1 || true

attempt=1
while [ "$attempt" -le 30 ]; do
  state="$(adb shell am get-started-user-state 0 2>/dev/null | tr -d '\r' || true)"
  echo "ANDROID_PRIMARY_USER_STATE=$state"
  if [ "$state" = "RUNNING_UNLOCKED" ]; then
    echo "ANDROID_USER_UNLOCK_PASS"
    exit 0
  fi
  sleep 1
  attempt=$((attempt + 1))
done

echo "ERROR: Android primary user remained locked; credential-encrypted app storage is unavailable." >&2
adb shell dumpsys user | tail -100 || true
adb shell dumpsys window | grep -Ei 'keyguard|mCurrentFocus|mFocusedApp' || true
exit 1
