#!/usr/bin/env bash
set -Eeuo pipefail

LOG_FILE="${RUNNER_TEMP:?RUNNER_TEMP is required}/server-e2e-instrumentation.log"
IDENTITY_FILE="$RUNNER_TEMP/server-e2e-identity.json"
ARTIFACT_DIR="${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}/artifacts/server-guest-browser-e2e"
INVITE_ON_DEVICE="/sdcard/Android/data/com.server.caller.debug/files/server-guest-invitation.txt"
INVITE_ON_HOST="$RUNNER_TEMP/server-guest-invitation.txt"

APP_APK="$(find artifacts/server-android-debug-apks -type f -name 'server-android-x86_64-debug.apk' -print -quit)"
TEST_APK="$(find artifacts/server-android-debug-apks -type f -name 'server-android-x86_64-androidTest.apk' -print -quit)"
if [[ -z "$APP_APK" || -z "$TEST_APK" || ! -s "$APP_APK" || ! -s "$TEST_APK" ]]; then
  echo "ERROR: downloaded x86_64 caller/test APK pair is incomplete." >&2
  find artifacts/server-android-debug-apks -type f -print | sort || true
  exit 1
fi
if [[ ! -s "$IDENTITY_FILE" ]]; then
  echo "ERROR: disposable Server E2E identity file is missing." >&2
  exit 1
fi

SERVER_TEST_TOKEN="$(node -e 'const v=require(process.argv[1]);process.stdout.write(v.access_token||"")' "$IDENTITY_FILE")"
SERVER_TEST_EXPIRY="$(node -e 'const v=require(process.argv[1]);process.stdout.write(String(v.access_expiry||""))' "$IDENTITY_FILE")"
SERVER_TEST_ID="$(node -e 'const v=require(process.argv[1]);process.stdout.write(v.server_id||"")' "$IDENTITY_FILE")"
SERVER_TEST_PHONE="$(node -e 'const v=require(process.argv[1]);process.stdout.write(v.test_phone||"")' "$IDENTITY_FILE")"
if [[ ! "$SERVER_TEST_TOKEN" =~ ^[0-9a-f]{64}$ || ! "$SERVER_TEST_EXPIRY" =~ ^[0-9]+$ || -z "$SERVER_TEST_ID" || ! "$SERVER_TEST_PHONE" =~ ^\+120255501[0-9]{2}$ ]]; then
  echo "ERROR: disposable Server E2E identity is incomplete or malformed." >&2
  exit 1
fi

adb get-state >/dev/null
adb install -r "$APP_APK"
adb install -r "$TEST_APK"
adb shell pm grant com.server.caller.debug android.permission.RECORD_AUDIO
adb shell pm grant com.server.caller.debug android.permission.READ_CONTACTS
adb shell pm grant com.server.caller.debug android.permission.POST_NOTIFICATIONS
mkdir -p "$ARTIFACT_DIR"
rm -f "$LOG_FILE" "$INVITE_ON_HOST"

# The Android emulator captures its microphone from the host's default PulseAudio
# source. Feed that source a deterministic tone so outbound Android audio cannot
# pass on RTP packet counters alone while carrying silence.
MIC_TONE_FILE="$ARTIFACT_DIR/server-android-mic-tone.wav"
node --input-type=module - "$MIC_TONE_FILE" <<'NODE'
import { writeFile } from "node:fs/promises";
const path=process.argv[2],rate=48000,seconds=20,count=rate*seconds,dataBytes=count*2;
const wav=Buffer.alloc(44+dataBytes);
wav.write("RIFF",0);wav.writeUInt32LE(36+dataBytes,4);wav.write("WAVE",8);
wav.write("fmt ",12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);
wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);
wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(dataBytes,40);
for(let i=0;i<count;i++){
  const envelope=Math.min(1,i/2400,(count-i)/2400);
  wav.writeInt16LE(Math.round(Math.sin(2*Math.PI*440*i/rate)*6500*envelope),44+i*2);
}
await writeFile(path,wav);
NODE
pactl load-module module-null-sink sink_name=server_e2e_mic rate=48000 channels=1 >/dev/null
pactl set-default-source server_e2e_mic.monitor
pactl list short sources | grep -F 'server_e2e_mic.monitor'
(paplay --device=server_e2e_mic "$MIC_TONE_FILE" >/dev/null 2>&1; while true; do paplay --device=server_e2e_mic "$MIC_TONE_FILE" >/dev/null 2>&1; done) &
TONE_PID=$!
echo "SERVER_ANDROID_MIC_AUDIO_PILOT=440Hz"

adb shell am instrument -w -r \
  -e class com.server.caller.CallerSmokeTest#preinstalledPhoneDialerOffersServerAsAnOutgoingCallChoice \
  -e server_test_token "$SERVER_TEST_TOKEN" \
  -e server_test_expiry "$SERVER_TEST_EXPIRY" \
  -e server_test_server_id "$SERVER_TEST_ID" \
  -e server_test_phone "$SERVER_TEST_PHONE" \
  com.server.caller.debug.test/androidx.test.runner.AndroidJUnitRunner \
  > "$LOG_FILE" 2>&1 &
INSTRUMENTATION_PID=$!

cleanup() {
  if [[ -n "${INSTRUMENTATION_PID:-}" ]] && kill -0 "$INSTRUMENTATION_PID" 2>/dev/null; then
    adb shell am force-stop com.server.caller.debug >/dev/null 2>&1 || true
    kill "$INSTRUMENTATION_PID" >/dev/null 2>&1 || true
    wait "$INSTRUMENTATION_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${TONE_PID:-}" ]] && kill -0 "$TONE_PID" 2>/dev/null; then
    kill "$TONE_PID" >/dev/null 2>&1 || true
    wait "$TONE_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

FOUND_INVITE=false
for attempt in $(seq 1 150); do
  if adb pull "$INVITE_ON_DEVICE" "$INVITE_ON_HOST" >/dev/null 2>&1 && test -s "$INVITE_ON_HOST"; then
    FOUND_INVITE=true
    break
  fi
  if ! kill -0 "$INSTRUMENTATION_PID" 2>/dev/null; then
    cat "$LOG_FILE" >&2 || true
    echo "Instrumentation ended before Android Telecom created the guest invitation." >&2
    exit 1
  fi
  sleep 1
done
if [[ "$FOUND_INVITE" != "true" ]]; then
  cat "$LOG_FILE" >&2 || true
  echo "Timed out waiting for Android Telecom to create the guest invitation." >&2
  exit 1
fi

SERVER_GUEST_INVITATION_FILE="$INVITE_ON_HOST" \
SERVER_E2E_ARTIFACT_DIR="$ARTIFACT_DIR" \
  node scripts/android-guest-browser-e2e.mjs

set +e
wait "$INSTRUMENTATION_PID"
TEST_STATUS=$?
set -e
INSTRUMENTATION_PID=""
cat "$LOG_FILE"
if [[ "$TEST_STATUS" -ne 0 ]]; then
  echo "The Android Telecom end-to-end instrumentation failed." >&2
  exit "$TEST_STATUS"
fi

adb pull "/sdcard/Android/data/com.server.caller.debug/files/server-guest-call-id.txt" \
  "$ARTIFACT_DIR/server-call-id.txt" >/dev/null 2>&1 || true
echo "SERVER_GUEST_ANDROID_BROWSER_E2E_PASS"
