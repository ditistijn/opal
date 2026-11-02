#!/usr/bin/env bash
# Regenerate every app icon size from the source artwork.
#   src-tauri/icons/opal.svg  →  opal.png (1024px, transparent)  →  pnpm tauri icon
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/render-icon.mjs src-tauri/icons/opal.svg src-tauri/icons/opal.png 1024
pnpm tauri icon src-tauri/icons/opal.png --output src-tauri/icons
# Opal ships for macOS only; drop the mobile icon sets `tauri icon` also emits.
rm -rf src-tauri/icons/android src-tauri/icons/ios
ls -1 src-tauri/icons
