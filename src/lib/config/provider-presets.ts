/**
 * Curated provider presets: starting points for the "Add provider" flow. Everything a preset fills in stays
 * editable (endpoint, models, headers); "Custom OpenAI-compatible" covers any other endpoint.
 *
 * Preset IDs double as the suggested OpenCode provider ID. Where possible they equal the models.dev catalog ID
 * (zai, zhipuai, deepseek, moonshotai, alibaba, openai, anthropic, openrouter, groq, togetherai) so OpenCode merges
 * catalog metadata (limits, pricing, reasoning variants) and picks its dedicated native protocol package.
 * Endpoints verified against OpenCode v2.2.5 packages/ai/src/providers/*.ts where a native package exists.
 *
 * Suggested model lists are a convenience snapshot (Nov 2026) — "Fetch models" reads the live list.
 */
import type { ModelConfig, ProviderConfig } from "@/lib/runtime/contracts"
import { nativeFetch } from "@/lib/native/http"

export type DiscoveryKind = "openai" | "ollama" | "lmstudio" | "anthropic" | "google"

export interface ProviderPreset {
  id: string
  name: string
  type: ProviderConfig["type"]
  /** Only for type "custom". */
  package?: string
  baseURL: string
  description: string
  docsURL: string
  /** Where the user creates an API key. */
  keyURL?: string
  requiresKey: boolean
  local?: boolean
  discovery: DiscoveryKind
  models: ModelConfig[]
}

const caps = (tools: boolean, vision: boolean, reasoning: boolean) => ({ tools, vision, reasoning })
const m = (
  id: string,
  name: string,
  contextWindow: number,
  maxOutputTokens: number,
  capabilities = caps(true, false, false),
): ModelConfig => ({ id, name, contextWindow, maxOutputTokens, capabilities, enabled: true })

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "zai",
    name: "Z.AI",
    type: "openai-compatible",
    baseURL: "https://api.z.ai/api/paas/v4",
    description: "GLM models from Z.AI (international), OpenAI-compatible API.",
    docsURL: "https://docs.z.ai/guides/overview/quick-start",
    keyURL: "https://z.ai/manage-apikey/apikey-list",
    requiresKey: true,
    discovery: "openai",
    models: [
      m("glm-5.3", "GLM-5.3", 1_000_000, 32_768, caps(true, false, true)),
      m("glm-4.6", "GLM-4.6", 200_000, 128_000, caps(true, false, true)),
      m("glm-4.5-air", "GLM-4.5-Air", 128_000, 96_000, caps(true, false, true)),
      m("glm-4.5v", "GLM-4.5V", 64_000, 16_384, caps(true, true, true)),
    ],
  },
  {
    id: "zhipuai",
    name: "Zhipu BigModel",
    type: "openai-compatible",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    description: "GLM models from Zhipu AI's BigModel platform (mainland China).",
    docsURL: "https://docs.bigmodel.cn/",
    keyURL: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
    requiresKey: true,
    discovery: "openai",
    models: [
      m("glm-4.6", "GLM-4.6", 200_000, 128_000, caps(true, false, true)),
      m("glm-4.5-air", "GLM-4.5-Air", 128_000, 96_000, caps(true, false, true)),
      m("glm-4.5v", "GLM-4.5V", 64_000, 16_384, caps(true, true, true)),
    ],
  },
  {
    id: "alibaba",
    name: "Qwen (DashScope)",
    type: "openai-compatible",
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    description: "Qwen models through Alibaba Cloud Model Studio's OpenAI-compatible mode.",
    docsURL: "https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope",
    keyURL: "https://modelstudio.console.alibabacloud.com/?tab=playground#/api-key",
    requiresKey: true,
    discovery: "openai",
    models: [
      m("qwen3-max", "Qwen3 Max", 262_144, 65_536),
      m("qwen-plus", "Qwen Plus", 1_000_000, 32_768, caps(true, false, true)),
      m("qwen3-coder-plus", "Qwen3 Coder Plus", 1_000_000, 65_536),
      m("qwen-flash", "Qwen Flash", 1_000_000, 32_768),
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "openai-compatible",
    baseURL: "https://api.deepseek.com/v1",
    description: "DeepSeek's chat and reasoning models.",
    docsURL: "https://api-docs.deepseek.com/",
    keyURL: "https://platform.deepseek.com/api_keys",
    requiresKey: true,
    discovery: "openai",
    models: [
      m("deepseek-chat", "DeepSeek Chat", 128_000, 8_192),
      m("deepseek-reasoner", "DeepSeek Reasoner", 128_000, 65_536, caps(true, false, true)),
    ],
  },
  {
    id: "moonshotai",
    name: "Moonshot (Kimi)",
    type: "openai-compatible",
    baseURL: "https://api.moonshot.ai/v1",
    description: "Kimi models from Moonshot AI.",
    docsURL: "https://platform.moonshot.ai/docs/introduction",
    keyURL: "https://platform.moonshot.ai/console/api-keys",
    requiresKey: true,
    discovery: "openai",
    models: [
      m("kimi-k2-0905-preview", "Kimi K2", 262_144, 32_768),
      m("kimi-k2-thinking", "Kimi K2 Thinking", 262_144, 32_768, caps(true, false, true)),
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    type: "openai",
    baseURL: "https://api.openai.com/v1",
    description: "GPT models from OpenAI.",
    docsURL: "https://platform.openai.com/docs/models",
    keyURL: "https://platform.openai.com/api-keys",
    requiresKey: true,
    discovery: "openai",
    models: [
      m("gpt-5", "GPT-5", 400_000, 128_000, caps(true, true, true)),
      m("gpt-5-mini", "GPT-5 mini", 400_000, 128_000, caps(true, true, true)),
      m("gpt-4.1", "GPT-4.1", 1_047_576, 32_768, caps(true, true, false)),
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    type: "anthropic",
    baseURL: "https://api.anthropic.com/v1",
    description: "Claude models through the Anthropic API.",
    docsURL: "https://docs.anthropic.com/en/docs/about-claude/models/overview",
    keyURL: "https://console.anthropic.com/settings/keys",
    requiresKey: true,
    discovery: "anthropic",
    models: [
      m("claude-sonnet-4-5", "Claude Sonnet 4.5", 200_000, 64_000, caps(true, true, true)),
      m("claude-opus-4-1", "Claude Opus 4.1", 200_000, 32_000, caps(true, true, true)),
      m("claude-haiku-4-5", "Claude Haiku 4.5", 200_000, 64_000, caps(true, true, true)),
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    type: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    description: "Hundreds of models from many labs behind one API key.",
    docsURL: "https://openrouter.ai/docs/quickstart",
    keyURL: "https://openrouter.ai/settings/keys",
    requiresKey: true,
    discovery: "openai",
    models: [
      m("z-ai/glm-4.6", "GLM-4.6", 202_752, 128_000, caps(true, false, true)),
      m("qwen/qwen3-coder", "Qwen3 Coder", 262_144, 65_536),
      m("deepseek/deepseek-chat-v3.1", "DeepSeek V3.1", 163_840, 65_536, caps(true, false, true)),
    ],
  },
  {
    id: "groq",
    name: "Groq",
    type: "openai-compatible",
    baseURL: "https://api.groq.com/openai/v1",
    description: "Very fast inference for open-weight models.",
    docsURL: "https://console.groq.com/docs/models",
    keyURL: "https://console.groq.com/keys",
    requiresKey: true,
    discovery: "openai",
    models: [
      m("moonshotai/kimi-k2-instruct-0905", "Kimi K2", 262_144, 16_384),
      m("openai/gpt-oss-120b", "GPT-OSS 120B", 131_072, 65_536, caps(true, false, true)),
      m("llama-3.3-70b-versatile", "Llama 3.3 70B", 131_072, 32_768),
    ],
  },
  {
    id: "togetherai",
    name: "Together AI",
    type: "openai-compatible",
    baseURL: "https://api.together.xyz/v1",
    description: "Open-weight models hosted by Together AI.",
    docsURL: "https://docs.together.ai/docs/serverless-models",
    keyURL: "https://api.together.ai/settings/api-keys",
    requiresKey: true,
    discovery: "openai",
    models: [
      m("Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8", "Qwen3 Coder 480B", 262_144, 65_536),
      m("deepseek-ai/DeepSeek-V3.1", "DeepSeek V3.1", 131_072, 32_768, caps(true, false, true)),
      m("zai-org/GLM-4.6", "GLM-4.6", 202_752, 65_536, caps(true, false, true)),
    ],
  },
  {
    id: "ollama",
    name: "Ollama",
    type: "ollama",
    baseURL: "http://127.0.0.1:11434/v1",
    description: "Models running locally with Ollama. No API key needed.",
    docsURL: "https://docs.ollama.com/openai",
    requiresKey: false,
    local: true,
    discovery: "ollama",
    models: [],
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    type: "lmstudio",
    baseURL: "http://127.0.0.1:1234/v1",
    description: "Models served by LM Studio's local server. No API key needed.",
    docsURL: "https://lmstudio.ai/docs/app/api/endpoints/openai",
    requiresKey: false,
    local: true,
    discovery: "lmstudio",
    models: [],
  },
  {
    id: "custom",
    name: "Custom (OpenAI-compatible)",
    type: "openai-compatible",
    baseURL: "",
    description: "Any endpoint that speaks the OpenAI Chat Completions API (vLLM, LiteLLM, proxies…).",
    docsURL: "https://opencode.ai/docs/providers/",
    requiresKey: false,
    discovery: "openai",
    models: [],
  },
]

export function findPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id)
}

/** The preset that best matches an existing provider (by id, then endpoint host, then type). */
export function presetForProvider(
  provider: Pick<ProviderConfig, "id" | "type" | "baseURL">,
): ProviderPreset | undefined {
  const byID = PROVIDER_PRESETS.find((preset) => preset.id === provider.id && preset.id !== "custom")
  if (byID) return byID
  const host = hostOf(provider.baseURL)
  const byHost = host
    ? PROVIDER_PRESETS.find((preset) => preset.baseURL && hostOf(preset.baseURL) === host)
    : undefined
  if (byHost) return byHost
  if (provider.type === "ollama" || provider.type === "lmstudio") return findPreset(provider.type)
  return undefined
}

export function discoveryKindFor(provider: Pick<ProviderConfig, "id" | "type" | "baseURL">): DiscoveryKind {
  if (provider.type === "ollama") return "ollama"
  if (provider.type === "lmstudio") return "lmstudio"
  if (provider.type === "anthropic") return "anthropic"
  if (provider.type === "google") return "google"
  return presetForProvider(provider)?.discovery ?? "openai"
}

function hostOf(url: string | undefined) {
  if (!url) return undefined
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

// ---------- model discovery ----------

export type DiscoveryResult =
  { ok: true; models: ModelConfig[]; source: string } | { ok: false; error: string }

export interface DiscoverOptions {
  /** Injected fetch (tests, or a native proxy that bypasses webview CORS). Defaults to globalThis.fetch. */
  fetch?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * Lists the models an endpoint serves:
 *  - OpenAI-compatible / OpenAI / OpenRouter: GET {baseURL}/models (Bearer key)
 *  - Ollama: GET {root}/api/tags (root = baseURL without /v1)
 *  - LM Studio: GET {root}/api/v0/models (context lengths), falling back to {baseURL}/models
 *  - Anthropic: GET {baseURL}/models (x-api-key)
 *  - Google: GET {baseURL}/models (x-goog-api-key)
 * Never throws; failures (network, CORS, auth) come back as a user-facing message.
 */
export async function discoverModels(
  provider: Pick<ProviderConfig, "id" | "type" | "baseURL" | "apiKey" | "headers">,
  options: DiscoverOptions = {},
): Promise<DiscoveryResult> {
  const kind = discoveryKindFor(provider)
  const baseURL = (provider.baseURL?.trim() || defaultDiscoveryBase(provider.type) || "").replace(/\/+$/, "")
  if (!baseURL) return { ok: false, error: "Enter the endpoint URL first." }
  try {
    new URL(baseURL)
  } catch {
    return { ok: false, error: `"${baseURL}" is not a valid URL.` }
  }
  const key = provider.apiKey?.trim()
  const headers: Record<string, string> = { Accept: "application/json", ...(provider.headers ?? {}) }
  if (kind === "anthropic") {
    if (key) headers["x-api-key"] = key
    headers["anthropic-version"] = "2023-06-01"
    headers["anthropic-dangerous-direct-browser-access"] = "true"
  } else if (kind === "google") {
    if (key) headers["x-goog-api-key"] = key
  } else if (key) {
    headers.Authorization = `Bearer ${key}`
  }
  const get = (url: string) => request(url, headers, options)

  if (kind === "ollama") {
    const root = baseURL.replace(/\/v1$/, "")
    const res = await get(`${root}/api/tags`)
    if (!res.ok) return { ok: false, error: describeFailure(res, root, provider.type) }
    return { ok: true, models: parseOllamaTags(res.body), source: `${root}/api/tags` }
  }
  if (kind === "lmstudio") {
    const root = baseURL.replace(/\/v1$/, "")
    const rich = await get(`${root}/api/v0/models`)
    if (rich.ok) return { ok: true, models: parseLMStudioModels(rich.body), source: `${root}/api/v0/models` }
  }
  const url = `${baseURL}/models`
  const res = await get(url)
  if (!res.ok) return { ok: false, error: describeFailure(res, baseURL, provider.type, Boolean(key)) }
  const models =
    kind === "google"
      ? parseGoogleModels(res.body)
      : kind === "anthropic"
        ? parseAnthropicModels(res.body)
        : parseOpenAIModels(res.body, provider.type === "openai")
  return { ok: true, models, source: url }
}

function defaultDiscoveryBase(type: ProviderConfig["type"]) {
  if (type === "ollama") return "http://127.0.0.1:11434/v1"
  if (type === "lmstudio") return "http://127.0.0.1:1234/v1"
  if (type === "openai") return "https://api.openai.com/v1"
  if (type === "anthropic") return "https://api.anthropic.com/v1"
  if (type === "google") return "https://generativelanguage.googleapis.com/v1beta"
  if (type === "openrouter") return "https://openrouter.ai/api/v1"
  return undefined
}

type Fetched =
  { ok: true; body: unknown } | { ok: false; status?: number; network?: boolean; message?: string }

async function request(
  url: string,
  headers: Record<string, string>,
  options: DiscoverOptions,
): Promise<Fetched> {
  // In the desktop app the request goes through Rust, where the provider's CORS policy does not apply.
  const doFetch = options.fetch ?? nativeFetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000)
  const abort = () => controller.abort()
  options.signal?.addEventListener("abort", abort)
  try {
    const res = await doFetch(url, { method: "GET", headers, signal: controller.signal })
    if (!res.ok) {
      let message: string | undefined
      try {
        const body = (await res.json()) as { error?: { message?: string } | string; message?: string }
        message = typeof body.error === "string" ? body.error : (body.error?.message ?? body.message)
      } catch {}
      return { ok: false, status: res.status, message }
    }
    return { ok: true, body: await res.json() }
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, network: true, message: "timed out" }
    return { ok: false, network: true, message: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener("abort", abort)
  }
}

function describeFailure(
  res: Exclude<Fetched, { ok: true }>,
  base: string,
  type: ProviderConfig["type"],
  hasKey = false,
) {
  const host = hostOf(base) ?? base
  if (res.network) {
    if (type === "ollama")
      return `Couldn't reach Ollama at ${host}. Is it running? Start it with \`ollama serve\`.`
    if (type === "lmstudio")
      return `Couldn't reach LM Studio at ${host}. Start the local server in LM Studio's Developer tab.`
    if (res.message === "timed out") return `${host} didn't respond in time.`
    return `Couldn't reach ${host}. The URL may be wrong or the server offline. You can still add model IDs manually.`
  }
  const detail = res.message ? ` — ${res.message}` : ""
  if (res.status === 401 || res.status === 403)
    return hasKey
      ? `The API key was rejected (${res.status})${detail}.`
      : `This endpoint needs an API key to list models (${res.status}). Enter the key and try again.`
  if (res.status === 404) return `${host} doesn't offer a model list (404). Add model IDs manually.`
  return `Fetching models failed (HTTP ${res.status ?? "error"})${detail}.`
}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)

const NON_CHAT =
  /(embed|whisper|tts|dall-e|moderation|davinci|babbage|transcribe|audio|realtime|image|rerank|speech|sora)/i

/** Media / task models that relays (new-api, one-api) list next to chat models. Used to pick a test model. */
const MEDIA_HINT =
  /(video|seedance|seedream|flux|^mj_|suno|veo|kling|vidu|pixverse|hailuo|happyhorse|i2v|t2v|r2v|lipsync|lip-sync)/i

/**
 * Relays such as new-api tag each model with the endpoints it serves (`supported_endpoint_types`).
 * When the tag is present, only models reachable through a chat endpoint are useful in a chat client;
 * the rest (image/video/music generation, TTS, rerank…) are task-based and reject chat requests.
 */
const CHAT_ENDPOINTS = new Set(["openai", "openai-response", "anthropic"])
function servesChat(item: Json) {
  const types = item.supported_endpoint_types
  if (!Array.isArray(types) || types.length === 0) return true
  return types.some((t) => typeof t === "string" && CHAT_ENDPOINTS.has(t.toLowerCase()))
}

/** True when a model ID looks like something that can answer a chat request. */
export function looksChatCapable(id: string) {
  return !NON_CHAT.test(id) && !MEDIA_HINT.test(id)
}

/** The model "Test connection" should call: the first enabled one that looks chat-capable. */
export function pickTestModel(models: Pick<ModelConfig, "id" | "enabled">[]) {
  const enabled = models.filter((model) => model.enabled !== false)
  return (enabled.find((model) => looksChatCapable(model.id)) ?? enabled[0])?.id
}

export function parseOpenAIModels(body: unknown, filterNonChat = false): ModelConfig[] {
  const list = isObject(body) && Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : []
  const models: ModelConfig[] = []
  for (const item of list) {
    if (!isObject(item)) continue
    const id = str(item.id)
    if (!id || id.includes("#")) continue
    if (filterNonChat && NON_CHAT.test(id)) continue
    if (!servesChat(item)) continue
    const architecture = isObject(item.architecture) ? item.architecture : undefined
    const topProvider = isObject(item.top_provider) ? item.top_provider : undefined
    const modalities = Array.isArray(architecture?.input_modalities)
      ? architecture.input_modalities
      : undefined
    const params = Array.isArray(item.supported_parameters) ? item.supported_parameters : undefined
    const outputModalities = Array.isArray(architecture?.output_modalities)
      ? architecture.output_modalities
      : undefined
    if (outputModalities && !outputModalities.includes("text")) continue
    models.push({
      id,
      name: str(item.name) ?? str(item.display_name) ?? id,
      contextWindow:
        num(item.context_length) ??
        num(item.context_window) ??
        num(item.max_context_length) ??
        num(topProvider?.context_length),
      maxOutputTokens:
        num(topProvider?.max_completion_tokens) ??
        num(item.max_output_tokens) ??
        num(item.max_completion_tokens),
      capabilities: {
        tools: params ? params.includes("tools") : true,
        vision: modalities ? modalities.includes("image") : false,
        reasoning: params ? params.includes("reasoning") : false,
      },
      enabled: true,
    })
  }
  return sortModels(models)
}

export function parseOllamaTags(body: unknown): ModelConfig[] {
  const list = isObject(body) && Array.isArray(body.models) ? body.models : []
  const models: ModelConfig[] = []
  for (const item of list) {
    if (!isObject(item)) continue
    const id = str(item.model) ?? str(item.name)
    if (!id || id.includes("#")) continue
    const details = isObject(item.details) ? item.details : undefined
    const families = Array.isArray(details?.families) ? details.families.map(String) : []
    if (/embed/i.test(id) || families.some((family) => /bert/i.test(family))) continue
    const size = str(details?.parameter_size)
    models.push({
      id,
      name: size ? `${id} (${size})` : id,
      capabilities: {
        tools: true,
        vision: families.some((family) => /clip|mllama|vision/i.test(family)),
        reasoning: false,
      },
      enabled: true,
    })
  }
  return sortModels(models)
}

export function parseLMStudioModels(body: unknown): ModelConfig[] {
  const list = isObject(body) && Array.isArray(body.data) ? body.data : []
  const models: ModelConfig[] = []
  for (const item of list) {
    if (!isObject(item)) continue
    const id = str(item.id)
    if (!id || id.includes("#")) continue
    if (item.type === "embeddings") continue
    models.push({
      id,
      name: id,
      contextWindow: num(item.max_context_length),
      capabilities: { tools: true, vision: item.type === "vlm", reasoning: false },
      enabled: true,
    })
  }
  return sortModels(models)
}

export function parseAnthropicModels(body: unknown): ModelConfig[] {
  const list = isObject(body) && Array.isArray(body.data) ? body.data : []
  return sortModels(
    list.filter(isObject).flatMap((item) => {
      const id = str(item.id)
      if (!id) return []
      return [
        {
          id,
          name: str(item.display_name) ?? id,
          capabilities: { tools: true, vision: true, reasoning: true },
          enabled: true,
        },
      ]
    }),
  )
}

export function parseGoogleModels(body: unknown): ModelConfig[] {
  const list = isObject(body) && Array.isArray(body.models) ? body.models : []
  return sortModels(
    list.filter(isObject).flatMap((item) => {
      const name = str(item.name)
      const methods = Array.isArray(item.supportedGenerationMethods) ? item.supportedGenerationMethods : []
      if (!name || !methods.includes("generateContent")) return []
      const id = name.replace(/^models\//, "")
      return [
        {
          id,
          name: str(item.displayName) ?? id,
          contextWindow: num(item.inputTokenLimit),
          maxOutputTokens: num(item.outputTokenLimit),
          capabilities: { tools: true, vision: true, reasoning: Boolean(item.thinking) },
          enabled: true,
        },
      ]
    }),
  )
}

function sortModels(models: ModelConfig[]) {
  const seen = new Set<string>()
  return models
    .filter((model) => (seen.has(model.id) ? false : (seen.add(model.id), true)))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Merges discovered models into the user's list: existing entries keep the user's edits (filling only missing
 * limits); new models are appended. Returns the merged list and how many were added.
 */
export function mergeDiscoveredModels(existing: ModelConfig[], discovered: ModelConfig[]) {
  const byID = new Map(discovered.map((model) => [model.id, model]))
  const merged = existing.map((model) => {
    const found = byID.get(model.id)
    if (!found) return model
    return {
      ...model,
      contextWindow: model.contextWindow ?? found.contextWindow,
      maxOutputTokens: model.maxOutputTokens ?? found.maxOutputTokens,
    }
  })
  const known = new Set(existing.map((model) => model.id))
  const added = discovered.filter((model) => !known.has(model.id))
  return { models: [...merged, ...added], added: added.length }
}
