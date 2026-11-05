/**
 * Pure mapping: Opal settings → the generated OpenCode config document (opencode.json).
 * Owner: providers/settings. Consumed by the runtime (which writes the file via Rust and reloads).
 *
 * Verified against OpenCode v2.2.5 (packages/schema/src/config.ts, config/provider.ts, config/agent.ts,
 * config/model.ts, config/experimental.ts; packages/core/src/config/plugin/provider.ts, provider.ts,
 * model-resolver.ts, aisdk-native.ts):
 *
 *  - Every provider listed under `providers` gets `activation: "enabled"` (config/plugin/provider.ts
 *    `overlayProvider`), so it is always "available" — with or without a credential.
 *  - For each configured provider OpenCode also registers an integration with a "Manually enter API Key" method
 *    whose integrationID is the provider ID. A key credential created with `integrationID = providerID` becomes the
 *    provider's `apiKey` (model-resolver.ts `nativeCredentialSettings`). Without credential or `settings.apiKey`, an
 *    enabled provider is called with no auth (correct for Ollama / LM Studio).
 *  - `package: "@ai-sdk/openai-compatible"` (and the other `@ai-sdk/*` names) are rewritten to OpenCode's native
 *    `@opencode/ai/providers/*` packages (aisdk-native.ts). Some provider IDs get a dedicated native package
 *    (zai, zhipuai, deepseek, moonshotai, alibaba …), and IDs that exist in the models.dev catalog inherit the
 *    catalog's model metadata.
 *  - A provider or model `package` may also name a native package directly. `@opencode/ai/providers/
 *    openai-compatible/responses` speaks the Responses API (/responses) to any OpenAI-compatible base URL; Opal
 *    uses it for providers/models whose `api` is "responses" (config.ts `Config.Model.package`).
 *  - `agents.<id>.system` replaces the base system prompt entirely; new agents start from Agent.Info.default
 *    permissions (`* allow`, `.env` reads ask) and configured rules are appended — the last matching rule wins.
 *
 * API keys are never written unless `apiKeyStorage: "file"` is requested AND the provider carries `apiKey`.
 */
import type { AppSettings, ModeID, ModelConfig, OpenAIApi, ProviderConfig } from "@/lib/runtime/contracts"
import { MODE_IDS, MODES } from "./prompts"
import { formatModelRef, isValidModelID, sanitizeProviderID } from "./ids"
import { VISION_AGENT_DESCRIPTION, VISION_AGENT_ID, VISION_SYSTEM_PROMPT, visionAgentModel } from "./vision"

export interface BuildInput {
  settings: AppSettings
  /** Final system prompt text per mode (built-in or override), already rendered. */
  prompts: Record<ModeID, string>
  /**
   * Absolute path of Opal's sandbox wrapper shell (`<root>/bin/sandbox/zsh`, src-tauri/src/sandbox_exec.rs), when it
   * is installed and sandbox-exec exists. Written as the top-level `shell` unless `settings.sandbox.mode` is "off".
   * OpenCode resolves `shell` in core/src/shell/select.ts (must be an existing file; the basename `zsh` keeps zsh
   * login/dialect semantics) and uses it for the shell tool (`-c`) and PTY terminals (`-l`).
   */
  sandboxShellPath?: string
}

export interface BuildOptions {
  /**
   * Where provider API keys live.
   *  - "credential" (default): in OpenCode's credential store (`client.credential.create({ integrationID: provider.id,
   *    value: { type: "key", key } })`). Nothing secret is written to opencode.json.
   *  - "file": `provider.apiKey` (when present) is written to `providers.<id>.settings.apiKey`.
   */
  apiKeyStorage?: "credential" | "file"
}

export type PermissionEffect = "allow" | "deny" | "ask"
export type PermissionRule = { action: string; resource: string; effect: PermissionEffect }

export type OpenCodeModelEntry = {
  name?: string
  package?: string
  limit?: { context?: number; output?: number }
  capabilities?: {
    tools?: boolean
    input?: string[]
    output?: string[]
    reasoning?: { supported: boolean }
  }
  disabled?: boolean
}

export type OpenCodeProviderEntry = {
  name: string
  package: string
  /** Provider-level defaults inherited by its models (@opencode/schema ProviderCompatibility). */
  compatibility?: { requireFinishReason?: boolean }
  settings?: Record<string, unknown>
  headers?: Record<string, string>
  models?: Record<string, OpenCodeModelEntry>
}

export type OpenCodeAgentEntry = {
  /** "providerID/modelID" — pins the agent to a model (used by the vision subagent). */
  model?: string
  system: string
  description: string
  mode: "primary" | "all" | "subagent"
  color: string
  permissions: PermissionRule[]
}

export type OpenCodeConfig = {
  $schema: string
  model?: string
  default_agent: ModeID
  share: "disabled"
  update: "disable"
  providers: Record<string, OpenCodeProviderEntry>
  agents: Record<ModeID, OpenCodeAgentEntry> & { [VISION_AGENT_ID]?: OpenCodeAgentEntry }
  policies?: { action: "provider.use"; resource: string; effect: "deny" }[]
  experimental: { artifacts: true; subagent_depth: number }
  shell?: string
}

export const CONFIG_SCHEMA_URL = "https://opencode.ai/config.json"

/** Provider type → provider package (AI SDK names; OpenCode maps them to its native packages). */
export const PACKAGE_FOR_TYPE: Record<Exclude<ProviderConfig["type"], "custom">, string> = {
  "openai-compatible": "@ai-sdk/openai-compatible",
  openai: "@ai-sdk/openai",
  anthropic: "@ai-sdk/anthropic",
  google: "@ai-sdk/google",
  openrouter: "@openrouter/ai-sdk-provider",
  ollama: "@ai-sdk/openai-compatible",
  lmstudio: "@ai-sdk/openai-compatible",
}

/** Default endpoints applied when a provider has no baseURL (only where OpenCode would not supply one). */
export const DEFAULT_BASE_URL: Partial<Record<ProviderConfig["type"], string>> = {
  ollama: "http://127.0.0.1:11434/v1",
  lmstudio: "http://127.0.0.1:1234/v1",
}

/** OpenCode's native Responses-API protocol for OpenAI-compatible endpoints (POST <baseURL>/responses). */
export const OPENAI_COMPATIBLE_RESPONSES_PACKAGE = "@opencode/ai/providers/openai-compatible/responses"

/**
 * True when `api` (chat / responses) applies: remote OpenAI-compatible endpoints. Ollama and LM Studio are left
 * out because the Responses package refuses to run without an API key ("Missing auth credential: apiKey"),
 * while those local servers are normally keyless.
 */
export function supportsApiChoice(provider: Pick<ProviderConfig, "type" | "package">): boolean {
  if (provider.type !== "openai-compatible" && provider.type !== "custom") return false
  return packageForProvider(provider) === PACKAGE_FOR_TYPE["openai-compatible"]
}

export function packageForProvider(provider: Pick<ProviderConfig, "type" | "package">): string {
  if (provider.type === "custom") return provider.package?.trim() || PACKAGE_FOR_TYPE["openai-compatible"]
  return PACKAGE_FOR_TYPE[provider.type]
}

export function buildOpenCodeConfig(input: BuildInput, options: BuildOptions = {}): OpenCodeConfig {
  const { settings, prompts } = input
  const storage = options.apiKeyStorage ?? "credential"

  const enabled = settings.providers.filter((provider) => provider.enabled)
  const providers: Record<string, OpenCodeProviderEntry> = {}
  for (const provider of enabled) {
    const id = sanitizeProviderID(provider.id)
    if (providers[id]) continue // first definition wins; ids are unique in valid settings
    providers[id] = providerEntry(provider, storage)
  }

  // A provider the user switched off must not stay usable through a catalog/env credential either.
  const disabledIDs = settings.providers
    .filter((provider) => !provider.enabled)
    .map((provider) => sanitizeProviderID(provider.id))
    .filter((id) => !providers[id])
  const policies = [...new Set(disabledIDs)]
    .sort()
    .map((resource) => ({ action: "provider.use" as const, resource, effect: "deny" as const }))

  const agents: OpenCodeConfig["agents"] = Object.fromEntries(
    MODE_IDS.map((mode) => [mode, agentEntry(mode, prompts[mode], settings)]),
  ) as Record<ModeID, OpenCodeAgentEntry>
  const visionModel = visionAgentModel(settings, new Set(disabledIDs))
  if (visionModel) agents[VISION_AGENT_ID] = visionAgentEntry(visionModel)

  const config: OpenCodeConfig = {
    $schema: CONFIG_SCHEMA_URL,
    default_agent: settings.defaultMode,
    share: "disabled",
    update: "disable",
    providers,
    agents,
    experimental: { artifacts: true, subagent_depth: 1 },
  }
  const model = defaultModel(settings, new Set(Object.keys(providers)), new Set(disabledIDs))
  if (model) config.model = model
  if (policies.length > 0) config.policies = policies
  const shell = sandboxShell(input)
  if (shell) config.shell = shell
  return config
}

/**
 * The sandbox wrapper as `shell` whenever it is installed — also with the sandbox mode "off": the wrapper then
 * runs plain zsh but still scrubs the engine password and credentials from the environment commands inherit.
 */
export function sandboxShell(input: Pick<BuildInput, "settings" | "sandboxShellPath">): string | undefined {
  const path = input.sandboxShellPath?.trim()
  if (!path || !path.startsWith("/")) return undefined
  return path
}

function providerEntry(provider: ProviderConfig, storage: "credential" | "file"): OpenCodeProviderEntry {
  const settings: Record<string, unknown> = {}
  const baseURL = provider.baseURL?.trim() || DEFAULT_BASE_URL[provider.type]
  if (baseURL) settings.baseURL = baseURL.replace(/\/+$/, "")
  if (storage === "file" && provider.apiKey?.trim()) settings.apiKey = provider.apiKey.trim()

  const apiChoice = supportsApiChoice(provider)
  const providerApi = apiChoice ? (provider.api ?? "chat") : undefined
  const entry: OpenCodeProviderEntry = {
    name: provider.name.trim() || provider.id,
    package: providerApi === "responses" ? OPENAI_COMPATIBLE_RESPONSES_PACKAGE : packageForProvider(provider),
  }
  const compatibility = providerCompatibility(provider)
  if (compatibility) entry.compatibility = compatibility
  if (Object.keys(settings).length > 0) entry.settings = settings
  const headers = cleanHeaders(provider.headers)
  if (headers) entry.headers = headers
  const models = modelEntries(provider.models, providerApi)
  if (models) entry.models = models
  return entry
}

/** Provider types that speak the OpenAI Chat protocol through third-party endpoints / proxies. */
const OPENAI_CHAT_TYPES: ReadonlySet<ProviderConfig["type"]> = new Set([
  "openai-compatible",
  "custom",
  "ollama",
  "lmstudio",
  "openrouter",
])

/**
 * OpenCode (packages/ai openai-chat protocol) fails a stream that ends without `finish_reason` and retries the
 * step. Proxies and local servers routinely omit that chunk, so Opal relaxes it for OpenAI-compatible providers
 * unless the user opts into strict streaming. See @opencode/schema model-compatibility.ts.
 */
export function providerCompatibility(
  provider: Pick<ProviderConfig, "type" | "strictStreaming">,
): { requireFinishReason: false } | undefined {
  if (provider.strictStreaming) return undefined
  if (!OPENAI_CHAT_TYPES.has(provider.type)) return undefined
  return { requireFinishReason: false }
}

function cleanHeaders(headers: Record<string, string> | undefined) {
  if (!headers) return undefined
  const entries = Object.entries(headers)
    .map(([key, value]) => [key.trim(), value] as const)
    .filter(([key]) => key.length > 0)
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

/** @param providerApi the provider's protocol when it supports the chat/responses choice, else undefined */
function modelEntries(models: ModelConfig[], providerApi?: OpenAIApi) {
  const result: Record<string, OpenCodeModelEntry> = {}
  for (const model of models) {
    const id = model.id.trim()
    if (!isValidModelID(id) || result[id]) continue
    result[id] = modelEntry(model)
    // A model whose protocol differs from its provider's gets its own package.
    if (providerApi && model.api && model.api !== providerApi)
      result[id] = {
        package:
          model.api === "responses"
            ? OPENAI_COMPATIBLE_RESPONSES_PACKAGE
            : PACKAGE_FOR_TYPE["openai-compatible"],
        ...result[id],
      }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function modelEntry(model: ModelConfig): OpenCodeModelEntry {
  const entry: OpenCodeModelEntry = {}
  const name = model.name.trim()
  if (name) entry.name = name
  const limit: NonNullable<OpenCodeModelEntry["limit"]> = {}
  if (isPositiveInt(model.contextWindow)) limit.context = model.contextWindow
  if (isPositiveInt(model.maxOutputTokens)) limit.output = model.maxOutputTokens
  if (Object.keys(limit).length > 0) entry.limit = limit
  const caps = model.capabilities
  if (caps) {
    const capabilities: NonNullable<OpenCodeModelEntry["capabilities"]> = {}
    if (caps.tools !== undefined) capabilities.tools = caps.tools
    if (caps.vision !== undefined) {
      capabilities.input = caps.vision ? ["text", "image"] : ["text"]
      capabilities.output = ["text"]
    }
    if (caps.reasoning !== undefined) capabilities.reasoning = { supported: caps.reasoning }
    if (Object.keys(capabilities).length > 0) entry.capabilities = capabilities
  }
  if (model.enabled === false) entry.disabled = true
  return entry
}

function isPositiveInt(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function defaultModel(settings: AppSettings, configured: Set<string>, disabled: Set<string>) {
  const ref = settings.defaultModel
  if (!ref?.providerID || !ref.id || !isValidModelID(ref.id)) return undefined
  const providerID = sanitizeProviderID(ref.providerID)
  if (disabled.has(providerID) && !configured.has(providerID)) return undefined
  return formatModelRef({ providerID, id: ref.id, variant: ref.variant })
}

// ---------- agents (modes) ----------

/** Read-only shell commands that never need approval, even in "ask" mode. */
const SAFE_SHELL = ["ls *", "pwd", "git status *", "git diff *", "git log *", "git show *", "rg *", "which *"]

/** Shell commands that always ask, even when the code surface runs in "auto" mode. */
const RISKY_SHELL = [
  "rm -rf *",
  "rm -fr *",
  "sudo *",
  "git push *",
  "git reset --hard *",
  "git clean *",
  "git checkout -- *",
  "git branch -D *",
]

export function agentPermissions(mode: ModeID, settings: Pick<AppSettings, "codeSurface">): PermissionRule[] {
  const outside: PermissionRule = { action: "external_directory", resource: "*", effect: "ask" }
  // Denying "execute" turns off OpenCode's Code Mode wrapper for the agent (core/src/tool.ts `snapshot`), so
  // the model calls artifact_create / read / shell … as discrete tools. Opal's transcript, artifact detection
  // and permission prompts rely on seeing those direct calls instead of one opaque `execute` script.
  const noCodeMode: PermissionRule = { action: "execute", resource: "*", effect: "deny" }
  if (mode !== "code") {
    // Chat conversations work freely inside their own sandbox folder; anything outside it asks first.
    return [noCodeMode, outside]
  }
  if (settings.codeSurface.permissionMode === "auto") {
    return [noCodeMode, outside, ...RISKY_SHELL.map((resource) => rule("shell", resource, "ask"))]
  }
  return [
    noCodeMode,
    rule("edit", "*", "ask"),
    rule("shell", "*", "ask"),
    ...SAFE_SHELL.map((resource) => rule("shell", resource, "allow")),
    outside,
  ]
}

function rule(action: string, resource: string, effect: PermissionEffect): PermissionRule {
  return { action, resource, effect }
}

/**
 * The image-fallback helper (src/lib/config/vision.ts): read-only, pinned to the fallback model. It may read
 * any conversation's uploads (Code sessions keep uploads outside the repo); everything else outside asks.
 */
export function visionAgentEntry(model: string): OpenCodeAgentEntry {
  return {
    model,
    system: VISION_SYSTEM_PROMPT,
    description: VISION_AGENT_DESCRIPTION,
    mode: "subagent",
    color: "#6A8CAF",
    permissions: [
      { action: "execute", resource: "*", effect: "deny" },
      { action: "edit", resource: "*", effect: "deny" },
      { action: "shell", resource: "*", effect: "deny" },
      { action: "subagent", resource: "*", effect: "deny" },
      { action: "external_directory", resource: "*", effect: "ask" },
      { action: "external_directory", resource: "*/conversations/*/uploads/*", effect: "allow" },
    ],
  }
}

function agentEntry(mode: ModeID, system: string, settings: AppSettings): OpenCodeAgentEntry {
  const definition = MODES[mode]
  return {
    system,
    description: definition.description,
    // "general" is also OpenCode's built-in subagent ID; "all" keeps it usable by the subagent tool.
    mode: mode === "general" ? "all" : "primary",
    color: definition.color,
    permissions: agentPermissions(mode, settings),
  }
}
