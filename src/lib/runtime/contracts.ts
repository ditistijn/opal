/**
 * Runtime contract — the typed surface every feature consumes.
 *
 * `src/lib/runtime/index.ts` implements these (Zustand stores + hooks fed by one SSE
 * subscription to the OpenCode sidecar). UI features import from "@/lib/runtime" only;
 * they never talk to @opencode/client directly, so the UI stays independent of transport.
 *
 * All OpenCode payload types are re-exported from "@/lib/opencode/types".
 */
import type {
  ModelInfo,
  ProviderInfo,
  AgentInfo,
  SessionInfo,
  SessionMessage,
  ArtifactInfo,
  ArtifactContent,
  PermissionRequest,
  ModelRef,
  FileDiff,
  FormInfo,
  FormAnswer,
} from "@/lib/opencode/types"

// ---------- surfaces & metadata ----------

/** Which Opal surface a session belongs to. Stored in session metadata `opal.surface`. */
export type Surface = "chat" | "code"

/** Agent modes = OpenCode agents Opal defines in opencode.json (see resources/prompts). */
export type ModeID = "artifact" | "code" | "general" | "research"

export interface OpalSessionMetadata {
  surface: Surface
  mode?: ModeID
  projectID?: string
  /** Absolute path of the conversation sandbox (chat) or repo/worktree directory (code). */
  directory?: string
  /** Code surface: the repo root this worktree belongs to, if the session runs in a worktree. */
  repoDirectory?: string
  worktreeBranch?: string
  starred?: boolean
}

// ---------- server ----------

export type ServerStatus =
  | { state: "starting"; message?: string }
  | { state: "ready"; url: string; version?: string }
  | { state: "error"; message: string; logs?: string[] }

// ---------- messages (projection of OpenCode messages + live events) ----------

export type ToolStatus = "streaming" | "running" | "completed" | "error"

export interface ToolPart {
  type: "tool"
  id: string
  name: string
  status: ToolStatus
  /** Parsed input when known (streaming input is partial JSON text). */
  input?: Record<string, unknown>
  inputText?: string
  /** Text content returned by the tool (joined). */
  output?: string
  error?: string
  metadata?: Record<string, unknown>
  time: { created: number; completed?: number }
}
export interface TextPart {
  type: "text"
  text: string
  /** True while deltas are still arriving. */
  streaming?: boolean
}
export interface ReasoningPart {
  type: "reasoning"
  text: string
  streaming?: boolean
  time?: { created: number; completed?: number }
}
export type MessagePart = TextPart | ReasoningPart | ToolPart

export interface AttachmentRef {
  name: string
  mime?: string
  /** file:// path inside the sandbox or data: URI for inline media. */
  uri?: string
  size?: number
}

export interface ChatMessage {
  id: string
  sessionID: string
  role: "user" | "assistant" | "system"
  /** Original OpenCode message type ("user" | "assistant" | "synthetic" | "system" | "shell" | "compaction" ...). */
  kind: SessionMessage["type"]
  parts: MessagePart[]
  attachments?: AttachmentRef[]
  model?: ModelRef
  agent?: string
  created: number
  completed?: number
  /** Assistant turn is still being generated. */
  streaming?: boolean
  error?: string
  tokens?: { input: number; output: number; reasoning?: number; cache?: { read: number; write: number } }
  cost?: number
  /** Files changed by this assistant turn (relative to session directory), from session.step.ended. */
  changedFiles?: string[]
}

export type SessionActivity = "idle" | "busy" | "queued" | "retry"

// ---------- prompts ----------

export interface DroppedFile {
  name: string
  /** Absolute path on disk (Tauri drag-drop) … */
  path?: string
  /** … or in-memory bytes (browser / paste). */
  bytes?: Uint8Array
  mime?: string
  size?: number
}

export interface PromptInput {
  text: string
  files?: DroppedFile[]
}

// ---------- settings ----------

export type ThemePreference = "system" | "light" | "dark"

export interface ProviderConfig {
  /** Stable id used as the OpenCode provider id and credential integrationID (e.g. "zai"). */
  id: string
  name: string
  /** Provider type → OpenCode provider package. */
  type:
    "openai-compatible" | "anthropic" | "openai" | "google" | "ollama" | "lmstudio" | "openrouter" | "custom"
  package?: string
  baseURL?: string
  /** Stored in OpenCode's credential store, never in settings.json. Present only transiently in forms. */
  apiKey?: string
  headers?: Record<string, string>
  models: ModelConfig[]
  enabled: boolean
  /**
   * Fail streams that end without a `finish_reason`. Off by default for OpenAI-compatible endpoints because many
   * proxies drop that final chunk (OpenCode then retried the whole step). Maps to compatibility.requireFinishReason.
   */
  strictStreaming?: boolean
  /**
   * Wire protocol for OpenAI-compatible endpoints: "chat" = /chat/completions (default), "responses" =
   * /responses. Some upstreams (OpenAI reasoning models behind relays) reject tools + reasoning_effort on
   * /chat/completions and only accept them on /responses. Individual models can override this.
   */
  api?: OpenAIApi
}

/** OpenAI-compatible wire protocol: /chat/completions or /responses. */
export type OpenAIApi = "chat" | "responses"

export interface ModelConfig {
  id: string
  name: string
  contextWindow?: number
  maxOutputTokens?: number
  capabilities?: { tools?: boolean; vision?: boolean; reasoning?: boolean }
  enabled?: boolean
  /** Overrides the provider's `api` for this model (OpenAI-compatible endpoints only). */
  api?: OpenAIApi
}

export interface Project {
  id: string
  name: string
  description?: string
  instructions?: string
  /** Absolute paths of knowledge files stored under projects/<id>/knowledge/. */
  knowledge: { name: string; path: string; size: number; added: number }[]
  defaultModel?: ModelRef
  defaultMode?: ModeID
  created: number
  updated: number
}

export interface AppSettings {
  theme: ThemePreference
  /** Max sessions executing concurrently against external APIs (client-side queue). */
  maxConcurrentConnections: number
  defaultModel?: ModelRef
  defaultMode: ModeID
  /** Per-mode system prompt overrides (markdown). Undefined = built-in prompt. */
  promptOverrides: Partial<Record<ModeID, string>>
  providers: ProviderConfig[]
  projects: Project[]
  codeSurface: {
    useWorktrees: boolean
    permissionMode: "ask" | "auto"
  }
  sidebarCollapsed: boolean
  lastSurface: Surface
}

// ---------- artifacts ----------

export type ArtifactKind =
  "html" | "react" | "markdown" | "mermaid" | "svg" | "json" | "csv" | "code" | "unknown"

export interface ArtifactVersion {
  n: number
  time: number
  /** Directory of the immutable snapshot. */
  path: string
  title: string
}

export interface ArtifactView {
  info: ArtifactInfo
  kind: ArtifactKind
  /** Preview URL served by the artifact:// protocol (Tauri) or a blob URL (browser). */
  previewURL: string
  versions: ArtifactVersion[]
}

// ---------- the runtime surface ----------

export interface Runtime {
  // server
  useServer(): ServerStatus
  restartServer(): Promise<void>

  // sessions
  useSessions(filter: {
    surface: Surface
    projectID?: string
    search?: string
    archived?: boolean
  }): SessionInfo[]
  useSession(sessionID: string | undefined): SessionInfo | undefined
  useChildSessions(parentID: string | undefined): SessionInfo[]
  createSession(input: {
    surface: Surface
    projectID?: string
    mode?: ModeID
    model?: ModelRef
    title?: string
    /** Code surface: repo directory (or worktree directory). Chat: omitted → sandbox is created. */
    directory?: string
    /** Code surface: repo root when `directory` is a worktree (stored in metadata.repoDirectory). */
    repoDirectory?: string
    /** Code surface: the worktree's branch (stored in metadata.worktreeBranch). */
    worktreeBranch?: string
  }): Promise<SessionInfo>
  renameSession(sessionID: string, title: string): Promise<void>
  deleteSession(sessionID: string): Promise<void>
  archiveSession(sessionID: string, archived: boolean): Promise<void>
  starSession(sessionID: string, starred: boolean): Promise<void>
  setSessionModel(sessionID: string, model: ModelRef): Promise<void>
  setSessionMode(sessionID: string, mode: ModeID): Promise<void>
  getOpalMetadata(session: SessionInfo): OpalSessionMetadata

  // messages
  useMessages(sessionID: string | undefined): ChatMessage[]
  useSessionActivity(sessionID: string | undefined): SessionActivity
  sendPrompt(sessionID: string, input: PromptInput): Promise<void>
  /** Edit a user message: forks/reverts to that point and resends. */
  editMessage(sessionID: string, messageID: string, input: PromptInput): Promise<void>
  regenerate(sessionID: string): Promise<void>
  interrupt(sessionID: string): Promise<void>

  // permissions
  usePermissions(sessionID: string | undefined): PermissionRequest[]
  replyPermission(sessionID: string, requestID: string, decision: "once" | "always" | "reject"): Promise<void>

  // catalog
  useModels(): ModelInfo[]
  useProviders(): ProviderInfo[]
  useAgents(): AgentInfo[]
  refreshCatalog(): Promise<void>

  // artifacts
  useArtifacts(sessionID: string | undefined): ArtifactInfo[]
  useArtifact(artifactID: string | undefined): ArtifactView | undefined
  getArtifactContent(artifactID: string): Promise<ArtifactContent>
  /** Replace an artifact's files (user edits in source view) — creates a new version. */
  updateArtifact(artifactID: string, files: Record<string, string>, title?: string): Promise<void>
  restoreArtifactVersion(artifactID: string, n: number): Promise<void>
  /** Called by the UI when the user wants the preview focused (auto-open on creation is handled by the runtime). */
  useActiveArtifact(sessionID: string | undefined): { artifactID?: string; setActive(id?: string): void }

  // files in the conversation sandbox
  useSessionFiles(
    sessionID: string | undefined,
  ): { path: string; name: string; size: number; modified: number }[]
  revealPath(path: string): Promise<void>
  openPath(path: string): Promise<void>
  saveFileAs(path: string): Promise<void>

  // code surface
  useSessionDiff(sessionID: string | undefined): FileDiff[]
  listRepos(): Promise<{ id: string; directory: string; name?: string }[]>
  pickDirectory(): Promise<string | undefined>
  /**
   * Creates an isolated git worktree of `repoDirectory` checked out at `base` (branch/ref, default HEAD) and
   * switches it to a new branch `branch` (default `opal/<repo>-<id>`). OpenCode's `worktree.create` `branch`
   * field is the *ref* passed to `git worktree add --detach`, so the named branch is created afterwards.
   */
  createWorktree(
    repoDirectory: string,
    base?: string,
    branch?: string,
  ): Promise<{ directory: string; branch: string }>

  // settings
  useSettings(): AppSettings
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  saveProvider(provider: ProviderConfig): Promise<void>
  deleteProvider(providerID: string): Promise<void>
  testProvider(
    provider: ProviderConfig,
    modelID?: string,
  ): Promise<{ ok: boolean; message: string; latencyMs?: number }>
  importOpenCodeConfig(): Promise<{ imported: number }>
  saveProject(project: Project): Promise<void>
  deleteProject(projectID: string): Promise<void>
  addProjectKnowledge(projectID: string, files: DroppedFile[]): Promise<void>
  getPrompt(mode: ModeID): Promise<{ builtin: string; override?: string }>
  setPromptOverride(mode: ModeID, text: string | undefined): Promise<void>
}

// ---- security & remote ----
// Sandbox (macOS sandbox-exec wrapper shell, src-tauri/src/sandbox_exec.rs) and remote control
// (src-tauri/src/remote_web.rs + src/lib/runtime/remote.ts). See docs/SECURITY.md.

/** off: plain zsh · filesystem: writes only in the working folder, temp and caches · strict: also no network. */
export type SandboxMode = "off" | "filesystem" | "strict"

export interface SandboxSettings {
  mode: SandboxMode
  /** Extra folders shell commands may write to (absolute paths). */
  allowPaths: string[]
}

export interface RemoteSettings {
  /** Allow other devices to connect (sidecar + Opal web UI reachable from the network). */
  enabled: boolean
  /** Listen on every network interface (Wi-Fi/LAN, Tailscale); off = this Mac only (ssh/tunnels). */
  lan: boolean
}

// Declaration merging: these fields are part of AppSettings.
export interface AppSettings {
  sandbox: SandboxSettings
  remote: RemoteSettings
}

// ---- updates ----
// Over-the-air updates (Tauri updater plugin, src/lib/native/updates.ts). See docs/UPDATES.md.

export interface UpdateSettings {
  /** Check GitHub Releases for a new version shortly after launch and every 6 hours. */
  autoCheck: boolean
}

// Declaration merging: part of AppSettings.
export interface AppSettings {
  updates: UpdateSettings
}

// ---- image fallback ----
// Images dropped into a chat whose model has no image input go to a "vision" subagent pinned to an
// image-capable model (src/lib/config/vision.ts; docs/PROVIDERS.md "Image fallback").

export interface ImageFallbackSettings {
  /** Route images through the vision helper when the chat's model can't see them. */
  enabled: boolean
  /** The image-capable model the helper runs on; adopted from the live catalog when unset. */
  model?: ModelRef
}

// Declaration merging: part of AppSettings.
export interface AppSettings {
  imageFallback: ImageFallbackSettings
}

/** cmd_sandbox_status */
export interface SandboxStatus {
  /** /usr/bin/sandbox-exec exists and the wrapper shell is installed. */
  available: boolean
  mode: SandboxMode
  allow: string[]
  /** Absolute path of the wrapper (`<root>/bin/sandbox/zsh`), written to opencode.json `shell`. */
  shellPath: string
}

/** cmd_remote_status */
export interface RemoteStatus {
  enabled: boolean
  lan: boolean
  lanIPs: string[]
  hostName?: string | null
  webPort: number
  sidecarPort: number
  /** http://<LAN IP>:<sidecar port> while remote control is on and the engine runs. */
  sidecarURL?: string | null
  /** http://<LAN IP>:<web port> while the Opal web UI is served. */
  webURL?: string | null
  webRunning: boolean
  /** The Mac's network addresses changed since the engine started; restarting refreshes CORS. */
  networkChanged: boolean
}

/** A one-time pairing link (5-minute, single use; OpenCode `POST /api/pair`). */
export interface RemotePairing {
  code: string
  /** Epoch ms. */
  expiresAt: number
  /** Opal web UI: http://<ip>:<webPort>/#rc=<base64url {url, code}> */
  link: string
  /** Fallback: OpenCode's own web UI, http://<ip>:<sidecarPort>/auth/connect/<code> */
  openCodeLink: string
}

// ---- forms ----
// OpenCode forms (`session.form.*`, events `form.created` / `form.replied` / `form.cancelled`): the
// `question` tool and MCP elicitations ask the user through a pending form; the turn waits until it is
// answered or cancelled. Implemented in src/lib/runtime/stores/forms.ts, rendered by QuestionCard.

/** A pending form (OpenCode `Form.Info`). `metadata.kind === "question"` for the question tool. */
export type FormRequest = FormInfo
/** Answer keyed by field key (OpenCode `Form.Answer`); omit unanswered / inactive fields. */
export type FormReply = FormAnswer

export interface Runtime {
  /** Pending forms for a session (loaded on first use, kept live by form events). */
  useForms(sessionID: string | undefined): FormRequest[]
  replyForm(sessionID: string, formID: string, answer: FormReply): Promise<void>
  /** Dismiss a pending form; `message` is returned to the asker (the model continues with it). */
  cancelForm(sessionID: string, formID: string, message?: string): Promise<void>
}
