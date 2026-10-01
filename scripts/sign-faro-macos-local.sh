#!/bin/zsh
set -euo pipefail

app_path="${1:?Usage: scripts/sign-faro-macos-local.sh /path/to/FARO.app}"
identity="${FARO_MACOS_SIGNING_IDENTITY:-FARO Local Development}"
entitlements_path="${0:A:h}/../src-tauri/Entitlements.plist"

if [[ ! -d "$app_path" ]]; then
  print -u2 "FARO.app no existe: $app_path"
  exit 1
fi

# Keep one stable local designated requirement across development builds.
# Credentials remain protected by macOS Keychain; this script never reads them.
codesign --force --deep --options runtime --sign "$identity" \
  --identifier "com.faroos.desktop" \
  --entitlements "$entitlements_path" \
  "$app_path"
codesign --verify --deep --strict --verbose=2 "$app_path"
codesign -d -r- "$app_path" 2>&1

# Inspect the signed artifact, not only the source plist.
codesign -d --entitlements - "$app_path" | /usr/bin/grep -q "com.apple.security.device.audio-input"
