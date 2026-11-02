# Development setup

## Prerequisites

| Tool | Version | Install |
| --- | --- | --- |
| macOS | 12 Monterey or newer (Apple silicon or Intel) | — |
| Xcode Command Line Tools | current (full Xcode only needed for notarization tooling updates) | `xcode-select --install` |
| Node.js | 24.x | `brew install node@24` or [nodejs.org](https://nodejs.org) |
| pnpm | 10.x | `corepack enable && corepack prepare pnpm@10 --activate` |
| Rust | stable (edition 2024 → ≥ 1.85) | `brew install rust` or [rustup.rs](https://rustup.rs) |
| Playwright Chromium | for `pnpm test:e2e` and icon rendering | `pnpm exec playwright install chromium` |

Verify:

```sh
xcode-select -p && node -v && pnpm -v && rustc -V && cargo -V
```

Then:

```sh
pnpm install
pnpm fetch:opencode     # stages src-tauri/binaries/opencode-<target-triple>
```

> **Maintainer note:** the arm64 sidecar is already staged at
> `src-tauri/binaries/opencode-aarch64-apple-darwin` (OpenCode v2.2.5). `pnpm fetch:opencode`
> detects it (`opencode --version`), writes a `.version` marker and skips the download.
> `src-tauri/binaries/` is git-ignored.

## Running

### Desktop app

```sh
pnpm app:dev
```

Starts Vite on `http://localhost:1420` and the Tauri shell, which spawns the bundled sidecar
(`opencode serve --hostname 127.0.0.1 --port <free port>`) with a random password and isolated
XDG directories under `~/Library/Application Support/Opal/opencode/`. If the sidecar binary is
missing, dev builds fall back to `~/.opencode/bin/opencode` or `opencode` on `PATH`.

In debug builds the **View** menu also has **Reload** (⌘R) and **Toggle Developer Tools** (⌥⌘I).

### Browser mode against an external OpenCode server

Useful for fast UI iteration and for integration tests — no Tauri APIs are needed (they are gated
behind `isTauri()`).

```sh
# terminal 1 — an isolated OpenCode server (does not touch ~/.config/opencode)
XDG_CONFIG_HOME=/tmp/opal-dev/config XDG_DATA_HOME=/tmp/opal-dev/data \
  OPENCODE_PASSWORD=dev opencode serve --hostname 127.0.0.1 --port 4096

# terminal 2
VITE_OPENCODE_URL=http://127.0.0.1:4096 VITE_OPENCODE_PASSWORD=dev pnpm dev
# → http://localhost:1420
```

You can use the staged sidecar as the server binary:
`src-tauri/binaries/opencode-aarch64-apple-darwin serve …`.

### Browser mode on the mock runtime

```sh
VITE_OPAL_MOCK=1 pnpm dev
```

Seeded in-memory data, no server. This is what the Playwright smoke test uses.

## Environment variables

Copy [`.env.example`](../.env.example) to `.env.local` (git-ignored) or export them in your shell.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `VITE_OPENCODE_URL` | frontend (browser mode) | Base URL of an external `opencode serve`, e.g. `http://127.0.0.1:4096`. Ignored inside the desktop app. |
| `VITE_OPENCODE_PASSWORD` | frontend (browser mode) | That server's Basic-auth password (`OPENCODE_PASSWORD`; username is `opencode`). Dev values only — `VITE_*` values are baked into builds. |
| `VITE_OPAL_MOCK` | frontend | `1` = in-memory mock runtime (UI dev, e2e). |
| `APPLE_SIGNING_IDENTITY` | `scripts/build-mac.sh`, Tauri bundler | Code-signing identity. Default: the only `Developer ID Application` identity in your keychain. |
| `APPLE_NOTARY_PROFILE` | `scripts/build-mac.sh` | `notarytool` keychain profile. Default: `opal-notary`. |
| `OPENCODE_VERSION` | `scripts/fetch-opencode.mjs` | Sidecar version to fetch (default: pinned `2.2.5`). |
| `OPAL_REPO_URL` | Rust build | Base URL for Help › Documentation / Report an Issue. |
| `E2E_PORT` | `playwright.config.ts` | Port of the e2e dev server (default `1430`). |

## Tests

```sh
pnpm typecheck            # tsc --noEmit (src, tests, scripts)
pnpm test                 # vitest unit tests (jsdom)
pnpm test:integration     # against a real OpenCode server (see tests/integration)
pnpm test:e2e             # Playwright smoke: title bar, surface switcher, sidebar; light + dark
cargo test --manifest-path src-tauri/Cargo.toml
```

`pnpm test:e2e` starts its own Vite server on port 1430 with `VITE_OPAL_MOCK=1` (or reuses one
already running there) and writes `test-results/screenshots/smoke-{light,dark}.png`.

CI (`.github/workflows/ci.yml`, `macos-latest`) runs typecheck, unit tests, `cargo check` and
`cargo test` — no signing and no secrets.

## Menu events

The native menu (`src-tauri/src/menu.rs`) emits global Tauri events. Subscribe with the typed helper
`onMenuEvents()` from `src/lib/native/menu-events.ts` (no-op outside Tauri), or directly with
`listen()` from `@tauri-apps/api/event`.

| Event | Payload | Menu item | Shortcut |
| --- | --- | --- | --- |
| `menu:check-updates` | `null` | Opal › Check for Updates… | — |
| `menu:settings` | `null` | Opal › Settings… | ⌘, |
| `menu:new-chat` | `null` | File › New Chat | ⌘N |
| `menu:new-project` | `null` | File › New Project | ⇧⌘N |
| `menu:toggle-sidebar` | `null` | View › Toggle Sidebar | ⇧⌘S |
| `menu:toggle-artifact-panel` | `null` | View › Toggle Artifact Panel | ⇧⌘A |
| `menu:surface` | `"chat"` \| `"code"` | View › Chat / View › Code | ⌘1 / ⌘2 |

```ts
import { useEffect } from "react"
import { onMenuEvents } from "@/lib/native/menu-events"

useEffect(
  () =>
    onMenuEvents({
      "menu:new-chat": () => startNewChat(),
      "menu:settings": () => openSettings(),
      "menu:surface": (surface) => setSurface(surface),
    }),
  [],
)
```

Rules for the frontend:

- Before emitting, Rust shows and focuses the main window (it may be hidden after ⌘W), so handlers
  can assume the UI is visible.
- **Key equivalents belong to the menu inside Tauri.** AppKit routes ⌘N, ⌘, ⇧⌘A … to the menu
  first. Keep `keydown` handlers for these shortcuts for the browser build, but skip them when
  `isTauri()` so an action never fires twice.
- Shortcuts that are *not* in the menu (⌘K search, Esc to stop) stay as normal `keydown` handlers.
- Edit menu items (Undo, Redo, Cut, Copy, Paste, Select All) are native predefined items: they act on
  the focused input/contenteditable in the webview with no frontend code.
- Window menu: Minimize (⌘M), Zoom, Bring All to Front; View › Enter Full Screen (⌃⌘F). Close Window
  (⌘W) hides the window (the app and its sidecar keep running); clicking the Dock icon shows it
  again; ⌘Q quits.
- Help › Opal Documentation / Report an Issue… open `OPAL_REPO_URL` (default
  `https://github.com/ditistijn/opal`) in the browser.

## Window chrome

Configured in `src-tauri/tauri.conf.json` and `menu.rs`:

- `titleBarStyle: "Overlay"` + `hiddenTitle` → full-size content view with a transparent title bar;
  `menu.rs` additionally sets `titlebarAppearsTransparent` via objc2.
- `trafficLightPosition {x: 14, y: 21}` → the traffic lights sit vertically centred in the 38px
  `TitleBar` (`--titlebar-height` in `src/index.css`). tao grows the title-bar container to
  `button height + y` and AppKit keeps the 14pt buttons 9pt above its bottom, so the button top is
  `y − 9` = 12pt and its centre 19pt = 38 / 2 (measured on macOS 26.5). For a different bar height
  `H`, use `y = H / 2 + 2`. Keep both in sync if either changes; the
  e2e smoke test asserts the title bar is 38px.
- The window background follows `--bg-sidebar` for the current appearance (light `#f0eee6`, dark
  `#1f1e1d`), so launch and live-resize never flash white. Update `SIDEBAR_LIGHT/DARK` in `menu.rs`
  if those tokens change.
- Sidebar vibrancy (`NSVisualEffectView`) is not enabled: it requires a transparent window plus
  translucent sidebar tokens in `src/index.css`; see docs/LIMITATIONS.md.

## App icon

Source artwork: `src-tauri/icons/opal.svg` (original; warm ivory tile, terracotta opal). Regenerate
every size after editing it:

```sh
bash scripts/make-icons.sh   # SVG → 1024px PNG (Playwright Chromium) → pnpm tauri icon
```

In-app assets: `public/favicon.svg` (browser tab) and `src/assets/opal-glyph.svg` (monochrome,
`currentColor`).
