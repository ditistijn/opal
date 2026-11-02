# Artifacts

How Opal renders OpenCode artifacts (`experimental.artifacts`), what the agent can build, and the
security model. Owner: artifacts (`src/features/artifacts`, `src/lib/artifacts`,
`src-tauri/src/{artifact_protocol,versions}.rs`, `public/artifact-runtime`).
Inline widgets (charts, small interactive widgets, diagrams rendered inside a chat message, using the
`widget.html` shell of the same runtime) are specified in [INLINE-WIDGETS.md](INLINE-WIDGETS.md).

## 1. Pipeline

```
artifact_create / artifact_update (OpenCode tool)
  → files written to <XDG_DATA_HOME>/opencode/artifacts/<id>/        (OpenCode local provider)
  → runtime re-lists artifacts, snapshots a version                  (cmd_snapshot_artifact)
  → ArtifactPanel: kind = detectKind(entry, files)
  → <iframe sandbox src=previewURL(info, kind)>
        html     artifact://localhost/<id>/<entry>
        other    artifact://localhost/_runtime/<kind>.html?id=<id>&entry=<entry>&theme=<light|dark>
  → the iframe posts opal:rendered | opal:error | opal:open-url back to the panel
```

* **Protocol** (`artifact_protocol.rs`): `artifact://localhost/<artifactID>/<path>` serves
  `<artifacts_dir>/<artifactID>/<path>`; `artifact://localhost/<artifactID>@<n>/<path>` serves version
  snapshot `n`; `artifact://localhost/_runtime/<file>` serves the renderer runtime (embedded in the
  binary with `include_bytes!`; debug builds read `public/artifact-runtime` from the repo so shells can be
  edited without rebuilding Rust). Responses: correct `Content-Type` (+`charset=utf-8` for text),
  `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, single `Range` support (media), small
  HTML 400/404 pages that also post `opal:error` to the panel.
* **Versions** (`versions.rs`): `<artifact_versions_dir>/<id>/<n>-<unix_ms>/{meta.json, files/…}`.
  `cmd_snapshot_artifact(artifactId, title)` copies the artifact dir (skipped when byte-identical to the
  previous snapshot — only the title is refreshed), `cmd_list_artifact_versions`,
  `cmd_read_artifact_version(artifactId, n)` → `{path: text}`. At most 50 versions (oldest pruned).
  Exports: `cmd_save_artifact_export(fileName, data)` (native save dialog → write) and
  `cmd_open_artifact_export(artifactId, html)` (temp file → default browser).
* **Browser dev** (no Tauri): there is no protocol, so `previewURL` points at the same shells served by
  Vite (`/artifact-runtime/<shell>.html?bridge=1&…`) and the shell asks the panel for the files over
  `postMessage` (`opal:ready` → `opal:files`). HTML artifacts use `html.html`, which inlines local
  `<link>`/`<script>`/`<img>` references and `document.write`s the page.

## 2. Kinds (what the agent should write)

Kind is chosen from the **entry** file (`detectKind`). OpenCode picks the entry as: explicit `entry`,
else `index.html`, else `index.md`, else the only file.

| Kind | Entry | Rendered by | Notes for the agent |
| --- | --- | --- | --- |
| HTML | `*.html` | loaded directly | Complete document. Relative files (`style.css`, `app.js`, `img/x.svg`) resolve inside the artifact. CDN scripts are fine. Optional: `<script src="/_runtime/error-bridge.js"></script>` as the first head script reports runtime errors to Opal (enables "Ask Opal to fix"). |
| React | `*.tsx` / `*.jsx` (or `.js/.ts` that imports React / contains JSX) | `react.html` | `export default function App()` (or the first exported capitalized component). TS/JSX transpiled in-browser with Sucrase. Tailwind v4 classes work (browser build). Relative imports between artifact files (`./data`, `../lib/x.ts`, `@/…` → artifact root or `src/`), `.css` (injected), `.json` and image imports are supported. |
| Markdown | `*.md` | `markdown.html` | GFM (tables, task lists, footnote-style links), fenced code highlighted with highlight.js, ` ```mermaid ` blocks rendered, relative images resolved. Document typography: serif headings, 680px measure. Follows light/dark theme. |
| Mermaid | `*.mmd` / `*.mermaid` | `mermaid.html` | Raw Mermaid source (a single surrounding ```` ```mermaid ```` fence is tolerated). Pan (drag/scroll), zoom (⌘/ctrl+wheel, buttons), double-click to fit. |
| SVG | `*.svg` | `svg.html` | Must include `xmlns="http://www.w3.org/2000/svg"`. Shown via `<img>` (scripts inside the SVG do not run); checkerboard + 1:1 toggles. |
| CSV/TSV | `*.csv` / `*.tsv` | `csv.html` | Header row required. Delimiter auto-detected (`,` `;` tab `|`); sortable columns, filter, first 5 000 rows rendered. |
| JSON | `*.json` | `json.html` | Collapsible tree + raw view. |
| Code | other text (`*.py`, `*.rs`, `*.sql`, …) | `code.html` | Highlighted source with line numbers. |
| File | images, PDF, … | loaded directly | OpenCode artifact files are UTF-8 strings, so binary files are rare. |

### React runtime details

* React **19.3.1** via an import map (`react`, `react/jsx-runtime`, `react-dom`, `react-dom/client` →
  `https://esm.sh/…`). Every other bare import is rewritten to
  `https://esm.sh/<pkg>@<pinned>?external=react,react-dom` so all packages share the single React.
* Pinned packages (see `PINNED` in `public/artifact-runtime/react.js`): recharts 2.15.4, lucide-react
  0.575.0, d3 7.9.0, three 0.170.0, framer-motion/motion 11.18.2, lodash 4.17.21, papaparse 5.5.3,
  mathjs 14.5.2, chart.js 4.5.0, react-chartjs-2 5.3.0, date-fns 4.1.0, clsx 2.1.1, tailwind-merge 3.3.1,
  class-variance-authority 0.7.1, zustand 5.0.6, tone 15.1.22, react-router-dom 7.6.3,
  @react-three/fiber 9.2.0, @react-three/drei 10.5.0, react-markdown 10.1.0, remark-gfm 4.0.1,
  xlsx 0.18.5, canvas-confetti 1.9.3, react-icons 5.5.0, … Unknown packages load esm.sh's latest
  version (works, but unpinned). Subpaths work (`lodash/debounce`).
* shadcn/ui-style imports work for a bundled subset: `@/components/ui/{alert, badge, button, card,
  checkbox, input, label, progress, select, separator, slider, switch, table, tabs, textarea}` and
  `@/lib/utils` (`cn`). Lightweight Tailwind re-implementations, not Radix. An artifact file
  `components/ui/<name>.tsx` overrides the bundled one. Other `@/components/ui/*` imports fail with a
  clear error listing what is available.
* Errors (transpile, module load, render, uncaught, unhandled rejection) are posted to the panel, which
  shows a banner with **Ask Opal to fix** → `runtime.sendPrompt(sessionID, "The artifact failed to render: <error>. Please fix it.")`.
* Not supported: circular imports between artifact files, Node built-ins, `require()`, server code.

### Prompt snippet (for `resources/prompts/artifact.md`)

> Artifacts render in a sandboxed panel. Use `index.html` for web pages (relative CSS/JS files are
> fine), `App.tsx` with `export default function App()` for React (Tailwind classes, recharts,
> lucide-react, d3, three, framer-motion and `@/components/ui/*` button/card/input/… are available;
> any other npm package is loaded from esm.sh), `index.md` for documents (mermaid fences render),
> `.mmd` for diagrams, `.svg` for vector graphics, `.csv`/`.json` for data. No localStorage-dependent
> logic; no network calls to localhost.

## 3. Panel (`src/features/artifacts`)

`ArtifactPanel({ sessionID })` → header (Preview | Code, title / artifact switcher, kind badge,
version menu "v3 · 2m ago", refresh, preview size Desktop/Tablet 768/Mobile 390, Copy + export menu
[Download as HTML, Download files (.zip) or the single file, Open in browser], full screen (Esc exits),
close = `setActive(undefined)`) and a body that is either the sandboxed preview (loading shimmer,
"taking longer" hint after 10 s, error banner) or the code view (file tabs, Shiki highlighting,
Edit → textarea → Save = `runtime.updateArtifact` with the full file map → a new version). Old versions
are previewed read-only from the snapshot (`<id>@<n>`) with "Restore this version"
(`runtime.restoreArtifactVersion`). The preview reloads whenever `info.time.updated` changes.

`ArtifactPanelView({ sessionID, rt })` is the same component with an injectable runtime slice; the dev
story `src/features/artifacts/__dev__/story.html` (served by `pnpm dev` at
`/src/features/artifacts/__dev__/story.html?artifact=art_react&theme=dark&width=640`) renders sample
artifacts of every kind without a server.

`src/lib/artifacts` exports: `detectKind`, `kindLabel`, `shikiLanguage`, `shellFor`, `previewURL`,
`sandboxFor`, `PREVIEW_SIZES`, `normalizeArtifactPath`, `isValidArtifactID`, `buildStandaloneHTML`,
`inlineHTMLArtifact`, `buildFilesZip`, `createZip`, `useArtifactErrors`, `parseArtifactMessage`,
`saveBytes`, `openInBrowser`, `openExternalURL`, `copyText`, `readVersionFiles`. The runtime can use
`previewURL(info, kind)` to fill `ArtifactView.previewURL`; the panel computes its own URL either way.

Exports: "Download as HTML" produces one self-contained file — HTML artifacts with local CSS/JS inlined
and assets as data: URIs; other kinds embed the renderer shell, its vendor scripts and the files as
`window.__OPAL_ARTIFACT__` (CDN dependencies such as React/esm.sh still need network when opened).

## 4. Security model

* **Isolated origin.** Artifacts run on `artifact://localhost`, a different origin from the app
  (`tauri://localhost` / `http://localhost:1420`). `allow-same-origin` only gives them *their own*
  origin (needed for `fetch` of sibling files and module imports); they cannot read the app's DOM,
  JS globals or storage.
* **Tauri IPC.** Note: Tauri 2 classifies *every registered custom scheme* (so also `artifact:`) as a
  "local" origin for its IPC ACL (`Webview::is_local_url`). What actually keeps artifacts out of IPC is
  that every invoke must carry the per-launch random 128-bit `__TAURI_INVOKE_KEY__`, which Tauri only
  injects into the **main frame** (its init scripts are `for_main_frame_only`; `withGlobalTauri` is off)
  and which a cross-origin iframe cannot read. Never register an initialization script with
  `initialization_script_for_all_frames`, and never post the invoke key or server credentials into an
  artifact frame. Possible hardening (untested in WKWebView, so not enabled): send
  `Content-Security-Policy: default-src * data: blob: artifact: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'`
  on protocol responses so `fetch("ipc://…")` from artifacts is blocked by CSP as a second layer.
* **Sandbox:** `allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads`;
  no `allow-top-navigation`. `referrerPolicy="no-referrer"`. In browser dev mode (shells served from
  the app origin) `allow-same-origin` is dropped, giving the frame an opaque origin.
* **No credentials.** The protocol has no auth and serves only artifact files and the runtime; the
  OpenCode password never reaches the iframe. The sidecar requires Basic auth, so an artifact calling
  `127.0.0.1:<port>` gets 401.
* **Path rules** (Rust `normalize_segments` + `resolve_in`, mirrored by `normalizeArtifactPath` and
  tested on both sides): artifact id must match `^art_[A-Za-z0-9_-]+$` (optional `@<n>`); the path is
  percent-decoded, empty/`.` segments dropped, `..`, NUL, `\` and `:` rejected; the final path is
  canonicalized and must stay inside the artifact (or snapshot) directory — symlinks pointing outside
  are refused; directories resolve to `index.html`. Version/export commands validate the id the same
  way; the save dialog's file name is reduced to one safe path component.
* **Messages.** The panel only accepts `postMessage` events whose `source` is its own iframe and
  validates every payload (`parseArtifactMessage`); `opal:open-url` only opens `http(s):`/`mailto:` in
  the default browser.
* **Markdown/SVG** render without sanitizing (the artifact already controls a full HTML/JS document in
  the same sandbox); SVG is shown via `<img>` so embedded scripts do not run.

## 5. Limitations

* React/Tailwind/Mermaid and npm packages come from CDNs (esm.sh, jsDelivr) — previews of those kinds
  need network access. Markdown, CSV, JSON, SVG, code and plain HTML render offline (Sucrase, marked
  and highlight.js are vendored in `public/artifact-runtime/vendor`, rebuilt with
  `node scripts/vendor-artifact-runtime.mjs`).
* `localStorage`/`sessionStorage`/IndexedDB on the custom `artifact://` scheme may be unavailable or
  non-persistent in WKWebView.
* The shadcn shims cover the common components only and are not pixel-identical to Radix-based shadcn.
* Windows/Android would expose the scheme as `http://artifact.localhost/…`; `ARTIFACT_ORIGIN` is the
  macOS form (Opal targets macOS).
* Version preview/code of old versions needs the desktop app (snapshots live on disk).
