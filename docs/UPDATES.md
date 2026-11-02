# Over-the-air updates

Opal updates itself with the official [Tauri updater plugin](https://v2.tauri.app/plugin/updater/)
(`tauri-plugin-updater` + `@tauri-apps/plugin-updater`), fed by GitHub Releases of
**https://github.com/ditistijn/opal**. Releases are built and published by `scripts/release-mac.sh`
(docs/RELEASING.md); this page describes what the app does with them.

## How it works

1. **Check.** The app asks the endpoint configured in `src-tauri/tauri.conf.json`:

   ```json
   "plugins": {
     "updater": {
       "endpoints": ["https://github.com/ditistijn/opal/releases/latest/download/latest.json"],
       "pubkey": "<base64 minisign public key>"
     }
   }
   ```

   GitHub redirects `/releases/latest/download/<asset>` to that asset on the newest **published,
   non-pre-release** release, so drafts and pre-releases are never offered to users. The request is
   made from Rust (not the webview), so the CSP is not involved.

2. **Compare.** The plugin compares `version` from the manifest with the running app's version
   (`tauri.conf.json` → `version`) as semver and reports an update only when the manifest is newer.

3. **Download + verify.** On "Update and restart" the plugin downloads the platform's `url`, verifies
   its minisign `signature` against the **public key embedded in the app** (the `pubkey` above) and
   refuses to install anything that does not verify. A compromised release page or CDN therefore
   cannot push code: only a holder of the private key can produce a valid signature.

4. **Install + relaunch.** The verified `Opal.app.tar.gz` replaces the running app bundle in place
   and Opal relaunches (`relaunch()` from `@tauri-apps/plugin-process`). The sidecar is stopped with
   the old process and started by the new one.

Nothing is installed without the user's click.

### latest.json

Written by `scripts/release-mac.sh` and attached to every release:

```json
{
  "version": "0.2.0",
  "notes": "Release notes (the CHANGELOG section for this version)",
  "pub_date": "2026-11-02T12:00:00.000Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<contents of Opal-0.2.0-aarch64.app.tar.gz.sig>",
      "url": "https://github.com/ditistijn/opal/releases/download/v0.2.0/Opal-0.2.0-aarch64.app.tar.gz"
    }
  }
}
```

`notes` is shown (as a short plain-text excerpt) in Settings → About; `pub_date` is RFC 3339. A Mac
whose platform key (`darwin-aarch64`, `darwin-x86_64`) is missing from `platforms` gets an error
from the check rather than an update.

### The update artifact

With `"bundle": { "createUpdaterArtifacts": true }` in `tauri.conf.json`, `tauri build` also produces
`Opal.app.tar.gz` (the Developer ID-signed app bundle, gzipped) and `Opal.app.tar.gz.sig` (its minisign
signature, made with `TAURI_SIGNING_PRIVATE_KEY`). `scripts/build-mac.sh` renames them to
`Opal-<version>-<arch>.app.tar.gz(.sig)` in `dist-mac/`. Without a signing key, `tauri build` refuses
to create updater artifacts; the build script then turns them off with `--config` and warns (also
with `--no-updater` and for dev builds), which is fine for local builds but not for a release
(`release-mac.sh` refuses to publish without them).

## In the app

| Piece | Where |
| --- | --- |
| Plugin registration | `src-tauri/src/lib.rs` (`tauri_plugin_updater::Builder::new().build()`) |
| Permission | `src-tauri/capabilities/default.json` → `updater:default` (`process:default` covers relaunch) |
| Service | `src/lib/native/updates.ts` — `checkForUpdates()`, `installUpdate(info, onProgress)`, `getAppVersion()`. Keeps the plugin's `Update` resource in a module-level map; callers only see plain `{ version, notes?, date? }`. In a plain browser it returns *"Updates are only available in the desktop app."* |
| State | `src/lib/native/update-store.ts` — zustand `useUpdates`: `status` (`idle · checking · none · available · downloading · installing · error`), `progress` 0–1, `available`, `error`, `lastChecked`, `check({ silent })`, `install()`, `dismiss()` |
| UI | Settings → About (version, "Check for updates" row, release-notes excerpt, progress bar, "Automatically check for updates" switch); `src/features/shell/UpdateBanner.tsx` (bottom-of-window notice: *Opal x.y.z is available — Update and restart / Later*) |
| Menu | Opal › Check for Updates… (id `check-updates`, event `menu:check-updates`) opens Settings → About and runs a visible check |

**Automatic checks.** While `settings.updates.autoCheck` is on (default), the desktop app runs a
*silent* check about 8 seconds after launch and every 6 hours. A silent check never shows
"Checking…" or an error; when it finds an update it shows the banner. "Later" hides the banner for
that version until the app restarts. Turning the switch off stops the timers immediately; the menu
item and the About button still work.

## The signing key

- **Public key**: embedded in `tauri.conf.json` → `plugins.updater.pubkey` (base64 of the minisign
  `.pub` file; key ID `53BE2FFB31E33A74`). Safe to commit.
- **Private key**: never in the repository. It lives on the release machine, by default at
  `~/.tauri/opal.key` (override with `OPAL_UPDATER_KEY`), or in `TAURI_SIGNING_PRIVATE_KEY`
  (+ `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if it has a password). Keep an offline backup (password
  manager or encrypted storage).

> **Losing the private key breaks updates.** Every installed copy of Opal only trusts the public key it
> was built with. Without the matching private key no future release can be signed for those copies:
> users would have to download and install a new DMG by hand.

### Rotating the key

Because installed apps only trust the old key, rotation needs one bridge release:

1. Generate a new pair: `pnpm tauri signer generate -w ~/.tauri/opal-next.key`.
2. Put the **new** public key in `tauri.conf.json` → `plugins.updater.pubkey`.
3. Build the bridge release with the **old** private key (`OPAL_UPDATER_KEY=~/.tauri/opal.key`), so
   existing installs accept it — they now carry the new public key.
4. From the next release on, sign with the new key (move it to `~/.tauri/opal.key`), and retire the
   old one once most users have updated past the bridge release.

If the old key is lost or compromised, skip step 3: ship the new public key in a release that users
install manually (DMG) and announce it in the release notes.

## Testing an update end to end

1. Install a released version (or a release build of an older version) into `/Applications`.
2. Publish a newer, signed release with `scripts/release-mac.sh`. Drafts and pre-releases are invisible
   to `/releases/latest/`, so the updater only sees it once it is published as the latest release.
3. In the installed app, Opal › Check for Updates… should offer the new version with its notes, and
   "Update and restart" should download (progress bar), verify, install and relaunch into it.
4. A tampered tarball or `.sig` must fail with a signature error in Settings → About and leave the
   installed app untouched.

In `pnpm app:dev` the check runs against the real endpoint too, but the dev binary is not a bundle, so
only test checking there, not installing.
