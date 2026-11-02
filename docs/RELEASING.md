# Releasing Opal

Opal follows [Semantic Versioning](https://semver.org/). Releases are cut from a developer Mac with
`pnpm release:mac`, which builds, signs, notarizes, tags and publishes a GitHub release in one go.
Installed copies pick the new version up through the built-in updater (docs/UPDATES.md).

The version lives in four places that must always agree:

| File                        | Key                                                                  |
| --------------------------- | -------------------------------------------------------------------- |
| `package.json`              | `version`                                                            |
| `src-tauri/tauri.conf.json` | `version` (becomes `CFBundleShortVersionString` / `CFBundleVersion`) |
| `src-tauri/Cargo.toml`      | `[package] version` (shown in Opal › About)                          |
| `src-tauri/Cargo.lock`      | the `opal` package entry                                             |

## One-time setup

- A **Developer ID Application** certificate in the login keychain (docs/BUILD.md §3). The build
  script uses the only one it finds; set `APPLE_SIGNING_IDENTITY` when there are several.
- A **notarytool keychain profile** named `opal-notary` (docs/BUILD.md §4), or
  `APPLE_NOTARY_PROFILE` pointing at another name.
- The **updater signing key** at `~/.tauri/opal.key` (docs/UPDATES.md). Without it the build has no
  OTA bundle and `pnpm release:mac` refuses to publish.
- `gh auth login` with push rights to the repository (`OPAL_REPO`, default `ditistijn/opal`).

Keep certificates, keychain profiles and the updater key out of the repository; the scripts only read
them from the keychain, the environment or `~/.tauri`.

## Checklist

1. **Start clean** — `main` is green in CI, working tree committed.

2. **Update the changelog** — move the items under `## [Unreleased]` in `CHANGELOG.md` into
   meaningful _Added / Changed / Fixed / Removed_ groups. Write for users, not commits: this section
   becomes the GitHub release notes and the text the updater shows.

3. **Bump the version** everywhere at once:

   ```sh
   node scripts/bump-version.mjs minor          # or patch | major | 0.2.0
   node scripts/bump-version.mjs 0.2.0 --dry-run
   ```

   It edits the four files above and inserts `## [x.y.z] — YYYY-MM-DD` under `## [Unreleased]`.

4. **Sidecar** — if OpenCode is being upgraded, update `PINNED_VERSION` in
   `scripts/fetch-opencode.mjs` and the `@opencode/client` version in `package.json` together, run
   `pnpm fetch:opencode --force`, re-verify the API notes in docs/ARCHITECTURE.md, and run
   `pnpm test:integration`.

5. **Verify**

   ```sh
   pnpm typecheck && pnpm test && pnpm test:e2e
   cargo test --manifest-path src-tauri/Cargo.toml
   ```

6. **Commit** the bump (`git commit -am "Release v0.2.0"`).

7. **Release**

   ```sh
   pnpm release:mac -- --dry-run    # build + stage, publish nothing: check dist-mac/ and latest.json
   pnpm release:mac                 # build, notarize, tag v0.2.0, push, publish with assets
   ```

   The script refuses to run on a dirty tree, an existing tag or an unnotarized build. It attaches:

   | Asset                                       | Purpose                                                                  |
   | ------------------------------------------- | ------------------------------------------------------------------------ |
   | `Opal-<version>-<arch>.dmg`                 | what people download and install                                         |
   | `Opal-<version>-<arch>.app.zip`             | the bare app bundle                                                      |
   | `Opal-<version>-<arch>.app.tar.gz` + `.sig` | the OTA bundle and its minisign signature                                |
   | `latest.json`                               | the manifest the updater polls (`/releases/latest/download/latest.json`) |
   | `Opal-<version>-<arch>.sha256`              | checksums                                                                |

   `--draft` publishes a draft (the updater ignores it until published); `--prerelease` marks a
   pre-release (`/releases/latest` skips those, so testers install it by hand); `--skip-build`
   reuses `dist-mac/` from a previous `pnpm build:mac`.

8. **Smoke test the DMG** on a clean user account or second Mac: open the DMG, drag to
   Applications, launch, confirm the sidecar starts (status in Settings), send a message with a
   configured provider, open an artifact, quit with ⌘Q and confirm no `opencode` process remains
   (`pgrep -fl "opencode serve"`).

9. **Smoke test the update** from the previous version: launch it, Opal › Check for Updates…, confirm
   the new version is offered, install, and check Opal › About shows the new version.

## Hotfixes

Branch from the release tag (`git switch -c release/0.2.x v0.2.0`), fix, `bump-version.mjs patch`,
then follow steps 5–9 and merge the branch back into `main`.

## Version numbers in builds

- `CFBundleShortVersionString` and `CFBundleVersion` both come from `tauri.conf.json` → `version`.
  Apple requires `CFBundleVersion` to increase for notarized updates of the same app; never re-use
  a version for a different build.
- The updater compares semver: an installed `0.2.0` only offers `latest.json` versions greater than
  `0.2.0`.
- Pre-releases (`0.3.0-beta.1`) are valid semver for npm/Cargo, but macOS only accepts numeric
  bundle versions: set `bundle.macOS.bundleVersion` in `tauri.conf.json` (e.g. `"0.3.0.1"`) for those.
