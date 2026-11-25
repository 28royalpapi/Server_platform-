#!/usr/bin/env bash
set -euo pipefail

PACKAGE_ID="${1:-}"
if [[ -z "$PACKAGE_ID" || "$PACKAGE_ID" != system-images\;* ]]; then
  echo "Usage: $0 'system-images;android-N;target;x86_64'" >&2
  exit 2
fi
if [[ -z "${ANDROID_HOME:-}" ]]; then
  echo "ANDROID_HOME is not set." >&2
  exit 2
fi

PACKAGE_DIR="$ANDROID_HOME/${PACKAGE_ID//;//}"
for attempt in 1 2 3; do
  echo "SDK_IMAGE_INSTALL_ATTEMPT=$attempt PACKAGE=$PACKAGE_ID"
  sdkmanager --install "$PACKAGE_ID" || true

  if [[ -s "$PACKAGE_DIR/package.xml" ]] &&
      find "$PACKAGE_DIR" -maxdepth 2 -name system.img -size +1M -print -quit | grep -q . &&
      sdkmanager --list_installed | grep -Fq "$PACKAGE_ID"; then
    echo "ANDROID_SYSTEM_IMAGE_READY: $PACKAGE_ID"
    exit 0
  fi

  echo "ANDROID_SYSTEM_IMAGE_INCOMPLETE: $PACKAGE_ID (attempt $attempt)" >&2
  # sdkmanager can leave a corrupt partial archive/extraction after a transient
  # network error. Remove only this package and the command-line-tools temp cache
  # before retrying; do not wipe the rest of the installed Android SDK.
  rm -rf "$PACKAGE_DIR" "$ANDROID_HOME/.temp"
  if [[ "$attempt" -lt 3 ]]; then sleep 5; fi
done

echo "ANDROID_SYSTEM_IMAGE_INSTALL_FAILED: $PACKAGE_ID" >&2
exit 1
