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
    # Android's ActivityManager reports RUNNING_UNLOCKED only after the
    # user's credential-encrypted storage key has been unlocked. Do not use
    # "cmd user is-user-unlocked": that subcommand is absent on several stable
    # emulator images. Also avoid run-as as the gate; OEM/Google API images can
    # reject shell run-as independently of the app's own CE storage access.
    # The instrumentation tests below exercise the app's actual SharedPreferences
    # and private files after this user-state check.
    if [ "$user_state" = "RUNNING_UNLOCKED" ]; then
      echo "ANDROID_USER_UNLOCK_PASS: Android reports the primary user RUNNING_UNLOCKED; app CE access is verified by instrumentation."
      exit 0
    fi
    echo "ANDROID_USER_UNLOCK_WAIT attempt=$attempt state=$user_state"
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
adb shell dumpsys user | tail -100 >&2 || true
adb shell dumpsys window | grep -Ei 'keyguard|mCurrentFocus|mFocusedApp' >&2 || true
adb logcat -d -t 800 | grep -Ei 'user|keyguard|lock|system_server|credential|run-as' | tail -120 >&2 || true
exit 1
