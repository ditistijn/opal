#!/usr/bin/env bash
# Build Opal for macOS.
#
#   scripts/build-mac.sh                 Release: Developer ID signing + notarization → dist-mac/
#   scripts/build-mac.sh --dev           Quick local build: debug profile, ad-hoc signed .app, no notarization
#
# Options
#   --dev                 debug build, ad-hoc signature ("-"), .app only (add --dmg for a DMG too)
#   --dmg                 with --dev: also build the DMG
#   --target <triple>     aarch64-apple-darwin (default on Apple silicon) or x86_64-apple-darwin
#   --no-notarize         release build without notarization (signed, but Gatekeeper will warn)
#   --skip-frontend       reuse the existing dist/ instead of running `pnpm build` (Rust-only rebuilds)
#   --no-updater          release build without the OTA update bundle (.app.tar.gz + .sig)
#   -h, --help
#
# Environment
#   APPLE_SIGNING_IDENTITY  default: the only "Developer ID Application" identity in the keychain
#   APPLE_NOTARY_PROFILE    notarytool keychain profile, default "opal-notary"
#   TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]  updater signing key (docs/UPDATES.md); when unset the key is
#                           read from $OPAL_UPDATER_KEY (default ~/.tauri/opal.key) if that file exists
#   OPENCODE_VERSION        sidecar version for scripts/fetch-opencode.mjs (default: pinned)
#   CI=true                 skip the Finder/AppleScript DMG window layout (headless machines)
#
# See docs/BUILD.md for the full walkthrough and Gatekeeper troubleshooting.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE=release
WANT_DMG=0
NOTARIZE=1
SKIP_FRONTEND=0
UPDATER=1
TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev) MODE=dev ;;
    --dmg) WANT_DMG=1 ;;
    --no-notarize) NOTARIZE=0 ;;
    --skip-frontend) SKIP_FRONTEND=1 ;;
    --no-updater) UPDATER=0 ;;
    --target) TARGET="$2"; shift ;;
    --target=*) TARGET="${1#--target=}" ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
NOTARY_PROFILE="${APPLE_NOTARY_PROFILE:-opal-notary}"
ENTITLEMENTS="$ROOT/src-tauri/entitlements.plist"
OUT="$ROOT/dist-mac"

bold() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------------------------
bold "Preflight"
[[ "$(uname -s)" == "Darwin" ]] || die "macOS only"
for tool in pnpm node cargo rustc xcrun codesign ditto shasum; do
  command -v "$tool" >/dev/null || die "missing tool: $tool (see docs/SETUP.md)"
done
HOST="$(rustc -vV | sed -n 's/^host: //p')"
TARGET="${TARGET:-$HOST}"
case "$TARGET" in
  aarch64-apple-darwin|x86_64-apple-darwin) ;;
  *) die "unsupported target: $TARGET" ;;
esac
VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
echo "Opal $VERSION · $MODE · $TARGET (host $HOST)"

if [[ "$MODE" == release ]]; then
  if [[ -z "$IDENTITY" ]]; then
    # Default to the Developer ID Application certificate in the login keychain (must be exactly one).
    FOUND="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | sort -u)"
    [[ -n "$FOUND" ]] || die "no \"Developer ID Application\" identity in the keychain; set APPLE_SIGNING_IDENTITY
       list available identities with: security find-identity -v -p codesigning"
    [[ "$(printf '%s\n' "$FOUND" | wc -l | tr -d ' ')" == 1 ]] \
      || die "several Developer ID identities found; set APPLE_SIGNING_IDENTITY to one of:
$FOUND"
    IDENTITY="$FOUND"
  fi
  security find-identity -v -p codesigning | grep -qF "\"$IDENTITY\"" \
    || die "signing identity not found in keychain: $IDENTITY
       list available identities with: security find-identity -v -p codesigning"
  TEAM_ID="$(printf '%s' "$IDENTITY" | sed -n 's/.*(\([A-Z0-9]\{10\}\))$/\1/p')"
  echo "Signing identity: $IDENTITY"
else
  IDENTITY="-"
  echo "Signing identity: ad-hoc (-)"
fi

# ---------------------------------------------------------------------------------------------
bold "Sidecar (OpenCode)"
SIDECAR="$ROOT/src-tauri/binaries/opencode-$TARGET"
if [[ -x "$SIDECAR" ]]; then
  echo "present: $SIDECAR"
else
  node scripts/fetch-opencode.mjs --target "$TARGET"
fi
[[ -x "$SIDECAR" ]] || die "sidecar missing after fetch: $SIDECAR"

if [[ "$MODE" == release ]]; then
  # Sign inside-out: the sidecar must carry a Developer ID signature + hardened runtime + secure
  # timestamp before the app bundle is sealed. (Tauri re-signs externalBin with the same identity and
  # entitlements while bundling; signing here as well keeps `pnpm app:dev` and the bundle consistent
  # and fails fast if the identity/keychain is not usable.)
  codesign --force --options runtime --timestamp \
    --entitlements "$ENTITLEMENTS" --sign "$IDENTITY" "$SIDECAR"
  codesign --verify --strict --verbose=2 "$SIDECAR"
  codesign -dvv "$SIDECAR" 2>&1 | grep -E "^(Authority|TeamIdentifier|Timestamp)=" | head -3
fi

# ---------------------------------------------------------------------------------------------
bold "Tauri build"
TAURI_ARGS=(build)
TARGET_DIR="$ROOT/src-tauri/target"
if [[ "$TARGET" != "$HOST" ]]; then
  rustup target list --installed 2>/dev/null | grep -qx "$TARGET" \
    || warn "Rust target $TARGET may not be installed (rustup target add $TARGET)"
  TAURI_ARGS+=(--target "$TARGET")
  TARGET_DIR="$TARGET_DIR/$TARGET"
fi
if [[ "$MODE" == dev ]]; then
  TAURI_ARGS+=(--debug)
  PROFILE_DIR="$TARGET_DIR/debug"
  if [[ "$WANT_DMG" == 1 ]]; then TAURI_ARGS+=(--bundles app,dmg); else TAURI_ARGS+=(--bundles app); fi
else
  PROFILE_DIR="$TARGET_DIR/release"
  TAURI_ARGS+=(--bundles app,dmg)
fi
BUNDLE_DIR="$PROFILE_DIR/bundle"
CONFIG_OVERRIDES=()
if [[ "$SKIP_FRONTEND" == 1 ]]; then
  [[ -f "$ROOT/dist/index.html" ]] || die "--skip-frontend: dist/index.html not found (run pnpm build once)"
  warn "reusing existing dist/ ($(date -r "$ROOT/dist/index.html" '+%Y-%m-%d %H:%M')) — frontend not rebuilt"
  CONFIG_OVERRIDES+=('"build":{"beforeBuildCommand":""}')
fi

# OTA update bundle (tauri.conf.json bundle.createUpdaterArtifacts = true): Tauri signs
# Opal.app.tar.gz with the minisign key in TAURI_SIGNING_PRIVATE_KEY and refuses to build without it,
# so the bundle is only requested when a key is available. Dev builds never produce one.
UPDATER_KEY_FILE="${OPAL_UPDATER_KEY:-$HOME/.tauri/opal.key}"
if [[ "$MODE" == dev ]]; then
  UPDATER=0
elif [[ "$UPDATER" == 1 && -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  if [[ -f "$UPDATER_KEY_FILE" ]]; then
    export TAURI_SIGNING_PRIVATE_KEY="$(cat "$UPDATER_KEY_FILE")"
    echo "Updater key: $UPDATER_KEY_FILE"
  else
    warn "no updater signing key (TAURI_SIGNING_PRIVATE_KEY unset, $UPDATER_KEY_FILE missing) — skipping the OTA bundle"
    UPDATER=0
  fi
fi
if [[ "$UPDATER" == 0 ]]; then
  CONFIG_OVERRIDES+=('"bundle":{"createUpdaterArtifacts":false}')
fi
if [[ ${#CONFIG_OVERRIDES[@]} -gt 0 ]]; then
  TAURI_ARGS+=(--config "{$(IFS=,; echo "${CONFIG_OVERRIDES[*]}")}")
fi

# Tauri signs the .app (and re-signs the sidecar) when APPLE_SIGNING_IDENTITY is set. Notarization is
# done below on the DMG via a keychain profile, so make sure Tauri doesn't attempt its own
# APPLE_ID/APPLE_API_KEY-based notarization of the bare .app with partially-set variables.
rm -rf "$BUNDLE_DIR/macos/Opal.app" "$BUNDLE_DIR/dmg"
env -u APPLE_ID -u APPLE_PASSWORD -u APPLE_API_KEY -u APPLE_API_ISSUER -u APPLE_API_KEY_PATH \
  APPLE_SIGNING_IDENTITY="$IDENTITY" pnpm tauri "${TAURI_ARGS[@]}"

APP="$BUNDLE_DIR/macos/Opal.app"
[[ -d "$APP" ]] || die "bundle not found: $APP"
DMG=""
if compgen -G "$BUNDLE_DIR/dmg/*.dmg" >/dev/null; then
  DMG="$(ls -t "$BUNDLE_DIR"/dmg/*.dmg | head -1)"
fi

# ---------------------------------------------------------------------------------------------
bold "Verify signature"
codesign --verify --deep --strict --verbose=2 "$APP"
echo "app:     $(codesign -dvv "$APP" 2>&1 | grep -E '^(Authority|Signature)=' | head -1)"
echo "sidecar: $(codesign -dvv "$APP/Contents/MacOS/opencode" 2>&1 | grep -E '^(Authority|Signature)=' | head -1)"
codesign -d --entitlements - --xml "$APP/Contents/MacOS/opencode" 2>/dev/null \
  | grep -q "com.apple.security.cs.allow-jit" || die "sidecar is missing its JIT entitlements"
plutil -extract CFBundleDisplayName raw "$APP/Contents/Info.plist" >/dev/null \
  || die "Info.plist was not merged (CFBundleDisplayName missing)"

# ---------------------------------------------------------------------------------------------
NOTARIZED=0
if [[ "$MODE" == release && "$NOTARIZE" == 1 ]]; then
  bold "Notarize"
  if [[ -z "$DMG" ]]; then
    warn "no DMG produced; skipping notarization"
  elif ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
    warn "notarytool keychain profile \"$NOTARY_PROFILE\" not found — skipping notarization."
    cat >&2 <<EOF

  Create it once (stores an app-specific password in your login keychain):

    xcrun notarytool store-credentials $NOTARY_PROFILE \\
      --apple-id <your-apple-id@example.com> \\
      --team-id $TEAM_ID \\
      --password <app-specific-password>

  App-specific passwords: https://account.apple.com → Sign-In and Security → App-Specific Passwords.
  Then re-run: pnpm build:mac   (or set APPLE_NOTARY_PROFILE to use another profile name)

EOF
  else
    echo "Submitting $(basename "$DMG") with profile $NOTARY_PROFILE (this can take a few minutes)…"
    SUBMIT_JSON="$(xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait --output-format json)"
    STATUS="$(printf '%s' "$SUBMIT_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.status+" "+j.id)})')"
    echo "notarytool: $STATUS"
    if [[ "$STATUS" != Accepted* ]]; then
      SUBMISSION_ID="${STATUS#* }"
      xcrun notarytool log "$SUBMISSION_ID" --keychain-profile "$NOTARY_PROFILE" >&2 || true
      die "notarization failed ($STATUS)"
    fi
    xcrun stapler staple "$DMG"
    # The app's cdhash was part of the DMG submission, so its ticket can be stapled too.
    xcrun stapler staple "$APP" || warn "could not staple the .app (DMG is stapled)"
    NOTARIZED=1
  fi
fi

# ---------------------------------------------------------------------------------------------
bold "Collect artifacts → dist-mac/"
mkdir -p "$OUT"
ARCH="${TARGET%%-*}"
SUFFIX="$VERSION-$ARCH"
[[ "$MODE" == dev ]] && SUFFIX="$SUFFIX-dev"
rm -rf "$OUT/Opal.app"
ditto "$APP" "$OUT/Opal.app"
ditto -c -k --keepParent "$APP" "$OUT/Opal-$SUFFIX.app.zip"
if [[ -n "$DMG" ]]; then
  cp -f "$DMG" "$OUT/Opal-$SUFFIX.dmg"
fi
rm -f "$OUT/Opal-$SUFFIX.app.tar.gz" "$OUT/Opal-$SUFFIX.app.tar.gz.sig"
if [[ "$UPDATER" == 1 ]]; then
  UPD="$BUNDLE_DIR/macos/Opal.app.tar.gz"
  [[ -f "$UPD" && -f "$UPD.sig" ]] || die "updater bundle missing: $UPD(.sig)"
  cp -f "$UPD" "$OUT/Opal-$SUFFIX.app.tar.gz"
  cp -f "$UPD.sig" "$OUT/Opal-$SUFFIX.app.tar.gz.sig"
fi
( cd "$OUT" && shasum -a 256 Opal-"$SUFFIX".dmg Opal-"$SUFFIX".app.zip $( [[ "$UPDATER" == 1 ]] && echo "Opal-$SUFFIX.app.tar.gz" ) > "Opal-$SUFFIX.sha256" )

if [[ "$MODE" == release ]]; then
  bold "Gatekeeper assessment"
  spctl --assess --type execute --verbose=2 "$OUT/Opal.app" 2>&1 || \
    warn "spctl rejected the app (expected until it is notarized)"
  if [[ -n "$DMG" ]]; then
    spctl --assess --type open --context context:primary-signature --verbose=2 "$OUT/Opal-$SUFFIX.dmg" 2>&1 || \
      warn "spctl rejected the DMG (expected until it is notarized)"
  fi
fi

bold "Done"
ls -lh "$OUT" | sed 1d
if [[ "$MODE" == release && "$NOTARIZED" == 0 ]]; then
  echo
  echo "Signed with \"$IDENTITY\" but NOT notarized — other Macs will show a Gatekeeper warning."
fi
