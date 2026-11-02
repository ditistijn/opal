# Building, signing and notarizing Opal

TL;DR

```sh
pnpm build:mac                        # release: Developer ID signed, notarized, stapled → dist-mac/
bash scripts/build-mac.sh --dev       # local: debug build, ad-hoc signed .app → dist-mac/
```

## 1. The OpenCode sidecar

Opal bundles the OpenCode CLI as a Tauri `externalBin`. Tauri expects it at
`src-tauri/binaries/opencode-<rust-target-triple>` and copies it to `Opal.app/Contents/MacOS/opencode`.

```sh
pnpm fetch:opencode                                  # host target, pinned version (2.2.5)
node scripts/fetch-opencode.mjs --target all         # aarch64 + x86_64
node scripts/fetch-opencode.mjs --dry-run            # print URLs, checksums and destinations only
node scripts/fetch-opencode.mjs --force              # re-download
OPENCODE_VERSION=2.2.6 pnpm fetch:opencode           # another release
```

What it does:

1. Downloads `SHA256SUMS` from `https://github.com/anomalyco/opencode/releases/download/v<version>/`.
2. Downloads `opencode-darwin-arm64.zip` (→ `aarch64-apple-darwin`) or `opencode-darwin-x64.zip`
   (→ `x86_64-apple-darwin`) and verifies its SHA-256 against `SHA256SUMS` before extracting.
3. Extracts the `opencode` binary, `chmod +x`, and writes `opencode-<triple>.version`
   (version + digest). Re-runs are no-ops while the marker matches; a binary without a marker is
   accepted if `opencode --version` reports the requested version.

The x64 asset requires AVX2; upstream also publishes `opencode-darwin-x64-baseline.zip` for older
Intel Macs (not wired up — Intel builds are not shipped yet).

## 2. Building

| Command                                       | Output                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm tauri build --bundles app --debug`      | `src-tauri/target/debug/bundle/macos/Opal.app` (unsigned)                               |
| `bash scripts/build-mac.sh --dev`             | debug `.app`, ad-hoc signed (`APPLE_SIGNING_IDENTITY=-`), copied to `dist-mac/`         |
| `bash scripts/build-mac.sh --dev --dmg`       | same, plus a DMG                                                                        |
| `pnpm build:mac`                              | release `.app` + `.dmg`, Developer ID signed, notarized + stapled when a profile exists |
| `pnpm build:mac --no-notarize`                | release, signed but not notarized                                                       |
| `pnpm build:mac --target x86_64-apple-darwin` | Intel build (needs `rustup target add x86_64-apple-darwin` and the x64 sidecar)         |

`tauri build` runs `pnpm build` (tsc + Vite) first, compiles the Rust app with the release profile
(LTO, stripped), copies the sidecar and `resources/prompts`, merges `src-tauri/Info.plist` into the
bundle's Info.plist, and builds the DMG.

`dist-mac/` then contains:

```
Opal.app
Opal-<version>-<arch>.dmg
Opal-<version>-<arch>.app.zip
Opal-<version>-<arch>.sha256
```

(`-dev` is appended to the names for `--dev` builds.)

## 3. Code signing

Opal is distributed outside the Mac App Store, so it is signed with a **Developer ID Application**
certificate and the **hardened runtime**.

```sh
security find-identity -v -p codesigning
#  "Developer ID Application: Your Name (TEAMID1234)"   ← release
#  "Apple Development: Your Name (ABCDE12345)"          ← not valid for distribution
```

`scripts/build-mac.sh` (release):

1. Signs the sidecar first (inside-out):
   `codesign --force --options runtime --timestamp --entitlements src-tauri/entitlements.plist --sign "$APPLE_SIGNING_IDENTITY" src-tauri/binaries/opencode-<triple>`
2. Runs `APPLE_SIGNING_IDENTITY=… pnpm tauri build --bundles app,dmg`. Tauri re-signs every
   `externalBin` and then the `.app` with the same identity, hardened runtime and entitlements.
3. Verifies: `codesign --verify --deep --strict`, the sidecar's JIT entitlements, the merged
   Info.plist.

### Entitlements (`src-tauri/entitlements.plist`)

The same file applies to the app and the sidecar (Tauri signs both with it). The sidecar is a Bun
single-file executable running JavaScriptCore with a JIT, so the set mirrors what upstream signs
`opencode` with: `cs.allow-jit`, `cs.allow-unsigned-executable-memory`,
`cs.disable-executable-page-protection`, `cs.allow-dyld-environment-variables`,
`cs.disable-library-validation`, plus `network.client/server`. Removing any of the `cs.*` keys makes
the sidecar crash at launch under the hardened runtime.

### Info.plist (`src-tauri/Info.plist`)

Merged over Tauri's generated plist: `CFBundleDisplayName` = Opal, `NSHumanReadableCopyright`,
`LSApplicationCategoryType` = productivity, `NSAppTransportSecurity.NSAllowsLocalNetworking`
(plain-HTTP to the `127.0.0.1` sidecar), `NSSupportsAutomaticTermination` /
`NSSupportsSuddenTermination` = false (Opal supervises a child process).

## 3b. Update bundle

With `bundle.createUpdaterArtifacts` enabled, `tauri build` also writes `Opal.app.tar.gz` and a
minisign signature next to the app, signed with the updater private key. The script reads the key
from `TAURI_SIGNING_PRIVATE_KEY` or, when that is unset, from `~/.tauri/opal.key` (`OPAL_UPDATER_KEY`
overrides the path). Without a key it warns and builds without the bundle; pass `--no-updater` to skip
it on purpose. Releases need it: see docs/UPDATES.md.

## 4. Notarization

The script notarizes the DMG with a **notarytool keychain profile** (default name `opal-notary`,
override with `APPLE_NOTARY_PROFILE`). Create it once:

```sh
xcrun notarytool store-credentials opal-notary \
  --apple-id <your-apple-id@example.com> \
  --team-id <your-team-id> \
  --password <app-specific-password>
```

Create the app-specific password at [account.apple.com](https://account.apple.com) → Sign-In and
Security → App-Specific Passwords. (An App Store Connect API key works too:
`store-credentials opal-notary --key AuthKey_XXXX.p8 --key-id XXXX --issuer <uuid>`.)

With the profile present the script runs:

```sh
xcrun notarytool submit src-tauri/target/release/bundle/dmg/Opal_<version>_<arch>.dmg \
  --keychain-profile opal-notary --wait
xcrun stapler staple src-tauri/target/release/bundle/dmg/Opal_<version>_<arch>.dmg
xcrun stapler staple src-tauri/target/release/bundle/macos/Opal.app
```

If the submission is not `Accepted`, the script prints `notarytool log <id>` and exits non-zero.
Without the profile it prints the command above and finishes with a signed, un-notarized build.

Check a result manually:

```sh
spctl --assess --type execute --verbose=2 dist-mac/Opal.app
spctl --assess --type open --context context:primary-signature --verbose=2 dist-mac/Opal-*.dmg
xcrun stapler validate dist-mac/Opal-*.dmg
```

`source=Notarized Developer ID` means Gatekeeper will open it on any Mac.

## 5. DMG

Tauri's DMG bundler lays out the window (app at 180,170, Applications link at 480,170, 660×400)
using Finder via AppleScript. On a headless machine (or if macOS asks for Automation permission and
you can't grant it) run with `CI=true` to skip the Finder layout step.

## 6. Troubleshooting

**"Opal is damaged and can't be opened" / "Apple could not verify…"** — the app is not notarized
(or was downloaded with a quarantine flag and is ad-hoc signed). For your own dev builds:
`xattr -dr com.apple.quarantine /Applications/Opal.app`. For distribution, notarize (§4).

**`spctl` says `rejected (the code is valid but does not seem to be an app)`** — you assessed the
DMG with `--type execute`; use `--type open --context context:primary-signature`.

**`spctl` says `source=Unnotarized Developer ID`** — signed correctly, notarization missing or not
stapled; create the notary profile and rebuild, or `xcrun stapler staple` the DMG.

**Notarization `Invalid`** — read `xcrun notarytool log <submission-id> --keychain-profile opal-notary`.
Typical causes: a binary without hardened runtime or secure timestamp (re-run the script; don't
hand-edit the bundle after signing), or the Apple Development identity used instead of Developer ID.

**Sidecar fails to start in the signed app but works in dev** — check its entitlements:
`codesign -d --entitlements - dist-mac/Opal.app/Contents/MacOS/opencode`. The JIT keys listed in §3
must be present. App logs (tauri-plugin-log): `~/Library/Logs/com.ditistijn.opal/`.

**`errSecInternalComponent` / codesign hangs** — the keychain is locked or codesign is waiting for
key-access approval. Unlock with `security unlock-keychain ~/Library/Keychains/login.keychain-db`
and click "Always Allow" once when prompted.

**`failed to bundle project: … binaries/opencode-<triple>` not found** — run `pnpm fetch:opencode`
(for cross builds: `--target x86_64-apple-darwin`).

**Gatekeeper cache** — after replacing an app with the same version, macOS may keep the old
assessment; `sudo spctl --reset-default` or bump the version.
