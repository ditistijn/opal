# Opal — Architecture

Opal is a native macOS desktop client (chat, Projects, Artifacts, and an agentic "Code" surface) on top of
**OpenCode** as the agent/execution engine, with unrestricted provider and model choice.

This document records the architectural decision (Phase 1) and the system design
that every part of the codebase follows. It was written against OpenCode **v2.2.5**
source (github.com/anomalyco/opencode, `packages/*`) — nothing here is assumed;
each API below was verified in the protocol/schema packages.

## 1. Decision: separate Tauri 2 frontend on the OpenCode server API (not a fork)

OpenCode 2.x is an Effect-based monorepo. The pieces that matter:

| Package | What it is |
| --- | --- |
| `packages/core` | Agent loop, sessions, providers, tools, permissions, **artifacts** (experimental), worktrees, PTY, VCS |
| `packages/server` | HTTP API (`/api/*`) + SSE event stream, basic-auth protected |
| `packages/protocol` / `packages/schema` | Typed route + payload definitions (Effect Schema) |
| `packages/client` | Generated Promise client (`@opencode/client` on npm, 2.2.5) incl. shared SSE event subscription |
| `packages/sdk` | In-process host (requires Bun/Node runtime, Effect) |
| `packages/app` | The upstream web UI — **SolidJS**, coding-IDE oriented |
| `packages/desktop` | The upstream desktop app — **Electron + SolidJS** (not Tauri) |

**Why not fork `packages/desktop`:** it is Electron + SolidJS with a heavily IDE-shaped
UI, i18n and plugin systems, and a strict upstream style guide. Rebuilding it into
Opal's UI would mean replacing essentially the whole renderer while carrying
Electron. The brief prefers Tauri 2 + React + Tailwind + shadcn/ui.

**Why reuse the server:** everything backend-shaped already exists and is stable
behind a typed HTTP/SSE API: sessions, streaming, tool calling, file editing,
permissions, provider/model catalog (models.dev + custom providers), credentials,
worktrees, PTY, VCS diffs, web search, subagents, **and an artifact subsystem**
(`experimental.artifacts`) with `artifact_create/read/update/delete` tools.

**Therefore:** Opal = Tauri 2 shell (Rust) + React 19 frontend, talking to a private
`opencode serve` **sidecar** over `127.0.0.1` using `@opencode/client`. We preserve
upstream compatibility by only using public routes and the config file format; no
patches to OpenCode.

## 2. Process model

```
┌──────────────────────────── Opal.app ─────────────────────────────┐
│  Rust core (Tauri 2)                                               │
│   • spawns sidecar: opencode serve --hostname 127.0.0.1 --port P   │
│       env OPENCODE_PASSWORD=<random>  XDG_*_HOME=<Opal dirs>       │
│   • custom URI scheme  artifact://  (serves artifact files from     │
│     disk, isolated origin, no credentials)                          │
│   • filesystem commands: conversation sandboxes, uploads, versions  │
│   • settings.json, native menu, window chrome                      │
│                                                                     │
│  WebView (React)                                                    │
│   • @opencode/client → http://127.0.0.1:P  (Basic auth "opencode") │
│   • SSE /api/event  → live projection of messages/tools/artifacts   │
│   • <iframe sandbox src="artifact://localhost/<id>/<entry>">        │
└─────────────────────────────────────────────────────────────────────┘
```

* The server password lives only in Rust + webview memory; it never reaches an
  artifact iframe (different origin, no auth) and is never logged.
* In the browser (dev/e2e) the app can also connect to an external server via
  `VITE_OPENCODE_URL` / `VITE_OPENCODE_PASSWORD` (no Tauri APIs needed).
* The sidecar binary is bundled as a Tauri `externalBin`
  (`src-tauri/binaries/opencode-<target-triple>`), downloaded by
  `scripts/fetch-opencode.mjs` from the pinned GitHub release
  (`opencode-darwin-arm64.zip`). In dev, `~/.opencode/bin/opencode` or `PATH` is used
  when the sidecar is missing.

### Directories (macOS)

```
~/Library/Application Support/Opal/
  settings.json                      app settings (theme, concurrency, defaults)
  opencode/
    config/opencode/opencode.json    generated OpenCode config (providers, agents, experimental)
    data/opencode/                   OpenCode DB, artifacts/<id>/, logs   (XDG_DATA_HOME)
    cache/opencode/  state/opencode/
  conversations/<sessionID>/         per-conversation sandbox ("cowork" dir, the session's location)
    uploads/                         files the user dropped into the chat
    ...                              anything the agent builds
  projects/<projectID>/knowledge/    Project knowledge files
  bin/sandbox/zsh, config.env        sandbox wrapper shell for agent commands (docs/SECURITY.md)
  remote/config.json, secret         remote control ports + persisted engine password (only while on)
  artifact-versions/<artifactID>/<n>-<ts>/   immutable snapshots of every artifact version
```

Isolation: the sidecar gets `XDG_DATA_HOME/XDG_CONFIG_HOME/XDG_CACHE_HOME/XDG_STATE_HOME`
pointing at `…/Opal/opencode/{data,config,cache,state}` so Opal never touches the
user's own `~/.config/opencode` or the background `opencode` service. An
"Import from OpenCode CLI config" action copies providers from `~/.config/opencode/opencode.json`.

## 3. OpenCode API map (verified, v2.2.5)

Auth: HTTP Basic, username `opencode`, password = `OPENCODE_PASSWORD`.
CORS already allows `tauri://localhost`, `http://tauri.localhost`, `http://localhost:*`.

| Need | Route / client call |
| --- | --- |
| Health | `GET /api/info` → `client.server.info()` |
| Events | `GET /api/event` (SSE) → `client.event.subscribe({types?})` (shared, reconnect-safe) |
| Sessions | `client.session.list({directory?, search?, parentID: null, archived})`, `.create({title?, agent?, model?, location:{directory}, metadata, permissions})`, `.get`, `.update({title, metadata, archived})`, `.remove`, `.fork` |
| Prompt | `client.session.prompt({sessionID, text, files?: [{uri: "data:…" or "file://…", name, mime?}]})` — durable admit, returns inbox item |
| Stop | `client.session.interrupt({sessionID})` |
| Messages | `client.message.list({sessionID, order, limit, cursor})` → `data: SessionMessage[]` (types: user, assistant, system, synthetic, shell, skill, compaction, idle, agent-switched, model-switched, location-switched) |
| Assistant content | `content: ({type:"text",text} \| {type:"reasoning",text} \| {type:"tool", id, name, state:{status: streaming\|running\|completed\|error, input, content, metadata, error}})[]` |
| Model/agent switch | `client.session.switchModel({sessionID, model:{providerID,id,variant?}})`, `.switchAgent({sessionID, agent})` |
| Models | `client.model.list({location?})` → `Model.Info[]` (`limit.context/output`, `capabilities.tools/input/output`, `cost[]`, `status`, `enabled`), `client.model.default()` |
| Providers | `client.provider.list()` → `Provider.Info[]` (`id,name,activation,package,settings,headers`) |
| Credentials | `client.credential.list/create({integrationID:<providerID>, value:{type:"key", key}, activate:true})/remove` — a key credential whose `integrationID` equals the provider id becomes that provider's `apiKey` (core/model-resolver.ts `nativeCredentialSettings`) |
| Config (read) | `client.config.get()` → ordered config documents. **Writes are file-based** (`config.update` only patches `shell`); Opal writes `opencode.json` directly; OpenCode watches the file and reloads (`config.updated`), or call `client.location.reload()` |
| Agents (modes) | `client.agent.list()`; defined in config `agents: { <id>: { system, description, mode:"primary", model?, permissions?, color? } }`. **`system` replaces the entire base system prompt**, so Opal's prompts are complete (see `resources/prompts/`) |
| Per-session instructions | `client.experimental.session.instructions.entry.put({sessionID, key, value})` — used for Project instructions, sandbox orientation, knowledge index (≤256 KB JSON each) |
| Permissions | event `permission.asked` {id, sessionID, action, resources, message}; reply `client.permission.reply({sessionID, requestID, decision: once\|always\|reject})`; list `client.permission.list({sessionID})` |
| Artifacts | config `experimental.artifacts: true` enables tools `artifact_create({title, files:{path:content}, entry?})`, `artifact_read`, `artifact_update({id, files, title?, entry?})`, `artifact_delete`. Routes: `client.experimental.artifacts.list({sessionID?})`, `.get({artifactID})` → `{info:{id,title,entry,url,provider,sessionID,time}, files}`; files on disk at `<XDG_DATA_HOME>/opencode/artifacts/<id>/` |
| Session diff | `client.session.diff({sessionID, from?, to?})` → `FileDiff.Info[]`; `client.vcs.get/status/branch.list/diff` |
| Worktrees | `client.worktree.list({projectID})`, `.create({projectID, branch?, name?, from?})`, `.remove({projectID, directory, force})`; `client.project.list()` |
| Terminal | `client.pty.create({cwd, command?})`, `.connectToken` → WebSocket `/api/pty/:id/connect?ticket=…` |
| Subagents | child sessions (`parentID`); `session.list({parentID})`; tool name `task`/subagent in `core/tool/plugin/subagent.ts` |
| Files | `client.file` (`fs.read/list/find`), `client.experimental.file.write`, `fs.watch` |
| Web search | `client.websearch.query`, config `websearch.provider` |

### Event stream (what the UI projects)

`session.status {sessionID, status:{type: idle\|busy\|retry}}`,
`session.created/renamed/deleted/archived/model.selected/agent.selected`,
`session.step.started/ended/failed {assistantMessageID, files?}`,
`session.text.started/delta/ended {assistantMessageID, ordinal, delta|text}`,
`session.reasoning.started/delta/ended`,
`session.tool.input.started {id, name} / delta / ended`, `session.tool.called {id, input}`,
`session.tool.progress {metadata}`, `session.tool.success {id, content, metadata}`, `session.tool.failed {id, error}`,
`session.message.content.updated`, `session.execution.*`, `permission.asked/replied`,
`config.updated`, `provider.updated`, `model.updated`, `agent.updated`, `artifact.updated` (providers list),
`pty.*`, `worktree.updated`, `location.shutdown`, `server.connected` (first event; resync on it).

Artifact change detection: on `session.tool.success` whose tool name (from
`session.tool.input.started`) is `artifact_create`/`artifact_update`, and on
`session.status idle`, Opal re-lists artifacts for the session, diffs
`time.updated`, fetches content, writes a version snapshot, and refreshes the preview.
A Rust `notify` watcher on `…/artifacts/<id>/` is the secondary trigger.

### Verified behaviours worth knowing (from the live acceptance run, 2026-11-01)

* **Code Mode.** By default OpenCode wraps tools in a single `execute` tool ("codemode"), so the model
  wrote the artifact through a JS script and events only showed `execute`. A permission rule
  `{ action: "execute", resource: "*", effect: "deny" }` on an agent turns Code Mode off for that agent
  (`core/src/tool.ts` `snapshot`), after which the model calls the discrete tools. Opal adds that rule to all
  four modes (`src/lib/config/build.ts` `agentPermissions`).
* **Namespaced tool names.** Direct artifact tools arrive as `opencode_artifact_create` /
  `opencode_artifact_update` / `opencode_artifact_read` (namespace prefix). Match with
  `baseToolName()` (`src/features/chat/tool-labels.ts`) or `/^(opencode_)?artifact_/`.
* **Config hot reload.** Rewriting `opencode.json` is picked up by the running sidecar without a restart
  (`agent.list` reflected new permissions within ~2s).
* **Catalog merge.** A provider id that exists in models.dev (e.g. `zai`) inherits the catalog's models in
  addition to the configured ones; the configured `settings.baseURL` applies to all of them.
* **Active artifact.** A conversation opens with its newest artifact showing; closing the pane is remembered
  per session for the app's lifetime (`stores/artifacts.ts`).

## 4. Frontend architecture

* React 19 + TypeScript (strict) + Vite 8, Tailwind CSS 4, shadcn-style components
  (Radix primitives) in `src/components/ui`.
* State: Zustand stores in `src/lib/runtime/*` (server, sessions, messages projection,
  permissions, artifacts, models, settings) fed by one SSE subscription; TanStack Query for
  request/cache where it fits.
* `src/lib/runtime/contracts.ts` is the **typed contract** every feature consumes.
* Native-only services live in `src/lib/native/*` (gated behind `isTauri()`): `menu-events.ts` (menu bar
  events), `updates.ts` + `update-store.ts` (over-the-air updates via the Tauri updater plugin and
  GitHub Releases, surfaced in Settings → About and `features/shell/UpdateBanner.tsx`; see docs/UPDATES.md).
* Surfaces: `src/features/chat` (chat + Projects + Artifacts), `src/features/code`
  (coding surface), `src/features/settings`, `src/features/artifacts`, `src/features/models`.
* Design system: `src/index.css` tokens define a warm-neutral palette,
  typography scale, spacing, borders; light + dark; native macOS feel
  (titlebar overlay, traffic-light inset, vibrancy sidebar).

### Conversations as sandboxes ("cowork")

Every Chat conversation owns `…/conversations/<sessionID>/` and that directory is the
session's OpenCode `location`. Files dropped into the composer are copied into
`uploads/` and attached to the prompt (`files: [{uri:"file://…"}]` for images/PDF; paths
for everything else) with an instruction entry telling the agent where they live. The agent
has OpenCode's full tool set inside that folder (read/edit/write/shell/websearch/artifacts),
so it can genuinely process data, build things and produce output files. Files the agent
creates are surfaced in a "Files" drawer (from `session.step.ended.files` + `fs.list`)
with reveal/open/save-as. The user never has to pick a folder.

### Projects

App-level entities (`settings.json` → `projects[]`): name, instructions, knowledge files,
default model/mode. A conversation links to a project via session metadata
`{ opal: { surface: "chat", projectID } }`; on creation Opal puts the project's instructions
and a knowledge index (and copies knowledge into the sandbox `knowledge/`) as instruction entries.

### Agent modes

`artifact` (default in Chat), `code` (default in Code), `general`, `research` — OpenCode
agents written to `opencode.json` from `resources/prompts/*.md`; users can inspect/edit
prompts in Settings → System prompts (overrides stored in settings and re-rendered).

### Concurrency

Settings → "Max concurrent API connections" (default 3): Opal queues `session.prompt`
calls client-side so at most N sessions execute at once (others show "Queued").
Server-side fan-out by subagents is additionally bounded via `experimental.subagent_depth`.
Limitation: OpenCode itself has no per-provider connection cap; the limiter is per Opal app.

### Code surface

Repos (OpenCode projects) → sessions per repo; new session may run in an isolated
git worktree (`worktree.create`), with a diff pane (`session.diff`/`vcs.diff`), an
integrated terminal (PTY over WebSocket + xterm), a subagent tree (child sessions), inline
permission prompts, and model/mode selection. Session metadata `{ opal: { surface: "code" } }`.

## 5. Security

* Artifact iframes: `sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"`
  on the separate `artifact://` origin — no Tauri IPC (`withGlobalTauri` off, protocol
  served with no auth), no server password, no file system beyond that artifact's folder.
* API keys: stored in OpenCode's credential store (or `opencode.json` `settings.apiKey` when
  the user opts for file storage); masked in UI; never logged; never in artifact context.
* Destructive operations outside the sandbox go through OpenCode permissions ("ask" rules
  for the Code surface; Chat sandboxes allow freely inside their own folder).
* Shell commands and terminals run through a macOS `sandbox-exec` wrapper (opencode.json `shell`) that only
  allows writes in the working folder, temp and caches (Strict: no network). Remote control rebinds the sidecar to
  `0.0.0.0` and serves the web UI to paired devices on the LAN. Both are described in **docs/SECURITY.md**.

## 6. Ownership map (for parallel implementation)

| Area | Paths |
| --- | --- |
| Shell | `src/App.tsx`, `src/main.tsx`, `src/index.css`, `src-tauri/src/lib.rs` |
| Runtime | `src/lib/opencode/*`, `src/lib/runtime/*`, `src/lib/config/*`, `src-tauri/src/{paths,sidecar,sandbox,config,sandbox_exec,remote_web}.rs`, `tests/integration/*` |
| Chat UI | `src/features/chat/*`, `src/features/sidebar/*`, `src/features/composer/*`, `src/features/projects/*`, `src/components/markdown/*` |
| Artifacts | `src/features/artifacts/*`, `src/lib/artifacts/*`, `src-tauri/src/{artifact_protocol,versions}.rs`, `public/artifact-runtime/*` |
| Providers/Settings | `src/features/settings/*`, `src/features/models/*`, `resources/prompts/*` |
| Code surface | `src/features/code/*` |
| macOS/packaging | `src-tauri/tauri.conf.json`, `src-tauri/Info.plist`, `src-tauri/entitlements.plist`, `src-tauri/src/menu.rs`, `src/lib/native/*`, `src/features/shell/UpdateBanner.tsx`, `scripts/*`, `README.md`, `docs/SETUP.md`, icons |
