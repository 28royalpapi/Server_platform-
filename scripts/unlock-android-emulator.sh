#!/bin/sh
set -eu

# Run after installing the debug APK. A user-state string alone is not enough
# on Android preview images: prove that app credential-encrypted storage works.
APP_ID="${SERVER_ANDROID_CE_PROBE_PACKAGE:-com.server.caller.debug}"
echo "ANDROID_USER_UNLOCK_START package=$APP_ID"
adb start-server >/dev/null 2>&1 || true
adb wait-for-device
if ! adb shell pm path "$APP_ID" 2>/dev/null | grep -q '^package:'; then
  echo "ERROR: $APP_ID must be installed before checking credential-encrypted storage." >&2
  exit 1
fi

attempt=1
while [ "$attempt" -le 90 ]; do
  device_state="$(adb get-state 2>/dev/null || true)"
  if [ "$device_state" = "device" ]; then
    # CI emulators contain no personal data; dismiss their swipe/PIN keyguard.
    adb shell cmd lock_settings set-disabled true >/dev/null 2>&1 || true
    adb shell settings put secure lockscreen.disabled 1 >/dev/null 2>&1 || true
    adb shell input keyevent 224 >/dev/null 2>&1 || true
    adb shell am unlock-user 0 >/dev/null 2>&1 || true
    adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
    adb shell input keyevent 82 >/dev/null 2>&1 || true
    adb shell input touchscreen swipe 540 1800 540 300 250 >/dev/null 2>&1 || true
    adb shell wm dismiss-keyguard >/dev/null 2>&1 || true

    user_state="$(adb shell am get-started-user-state 0 2>/dev/null | tr -d '\r' || true)"
    unlocked="$(adb shell cmd user is-user-unlocked 0 2>/dev/null | tr -d '\r' | tail -1 || true)"
    # Decisive check: run-as must write in the installed app's private CE data.
    if adb shell run-as "$APP_ID" sh -c 'touch .server-ce-unlock-probe && rm -f .server-ce-unlock-probe' >/dev/null 2>&1; then
      echo "ANDROID_USER_UNLOCK_PASS: app credential storage is accessible (state=$user_state, user_unlocked=$unlocked)"
      exit 0
    fi
    echo "ANDROID_USER_UNLOCK_WAIT attempt=$attempt state=$user_state user_unlocked=$unlocked"
  else
    echo "ANDROID_ADB_WAIT attempt=$attempt state=${device_state:-missing}"
  fi
  adb reconnect offline >/dev/null 2>&1 || true
  adb reconnect device >/dev/null 2>&1 || true
  sleep 2
  attempt=$((attempt + 1))
done

echo "ERROR: Android app credential-encrypted storage remained unavailable." >&2
adb devices -l >&2 || true
adb shell am get-started-user-state 0 >&2 || true
adb shell cmd user is-user-unlocked 0 >&2 || true
adb shell dumpsys user | tail -100 >&2 || true
adb shell dumpsys window | grep -Ei 'keyguard|mCurrentFocus|mFocusedApp' >&2 || true
adb logcat -d -t 800 | grep -Ei 'user|keyguard|lock|system_server|credential|run-as' | tail -120 >&2 || true
exit 1
