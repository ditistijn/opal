/**
 * Providers, credentials and the generated opencode.json.
 *
 * Verified against OpenCode 2.2.5 core:
 *  - A `key` credential whose `integrationID` equals the provider id is that provider's active
 *    connection (Integration.connection.active(provider.integrationID ?? providerID) works even with
 *    no registered integration) and becomes `settings.apiKey` for the model package
 *    (model-resolver.ts `nativeCredentialSettings`).
 *  - A config provider without `integrationID` and without a registered integration of the same id
 *    is always available (provider.ts snapshot()), so custom providers need no activation flag.
 *  - Config writes are file-based; `location.reload()` rebuilds every loaded location (running
 *    sessions continue at the next step; pending permissions are cancelled).
 */
import { buildOpenCodeConfig } from "@/lib/config/build"
import { BUILTIN_PROMPTS, renderAllPrompts } from "@/lib/config/prompts"
import { whenReady } from "@/lib/opencode/client"
import { isTauri } from "@/lib/utils"
import type { AppSettings, ModeID, ModelConfig, ProviderConfig } from "./contracts"
import { native } from "./native"
import { sandboxShellPath } from "./sandbox"
import { refreshCatalog } from "./stores/catalog"
import { getSettings, loadSettings, stripSecrets, updateSettings } from "./stores/settings"

const MASK = "••••"
const TEST_TIMEOUT_MS = 45_000

export function isMaskedKey(key: string | undefined) {
  return !key || key.includes(MASK)
}

export async function builtinPrompt(mode: ModeID): Promise<string> {
  if (isTauri()) {
    try {
      return await native.readPrompt(mode)
    } catch {
      // fall back to the bundled copy
    }
  }
  return BUILTIN_PROMPTS[mode]
}

async function renderedPrompts(settings: AppSettings) {
  const modes = Object.keys(BUILTIN_PROMPTS) as ModeID[]
  const builtins = Object.fromEntries(
    await Promise.all(modes.map(async (m) => [m, await builtinPrompt(m)])),
  ) as Record<ModeID, string>
  return renderAllPrompts(settings.promptOverrides, builtins)
}

function stableJSON(value: unknown) {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  )
}

/**
 * Regenerates opencode.json from settings and reloads the server when it changed.
 * Returns true when a new config was applied.
 */
export async function applyConfig(options: { reload?: boolean } = {}): Promise<boolean> {
  const settings = await loadSettings().then(() => getSettings())
  let config: Record<string, unknown>
  try {
    config = buildOpenCodeConfig({
      settings,
      prompts: await renderedPrompts(settings),
      sandboxShellPath: await sandboxShellPath(),
    })
  } catch (error) {
    console.warn("[opal:config] buildOpenCodeConfig failed; keeping the current opencode.json", String(error))
    return false
  }
  if (!isTauri()) {
    // LIMITATION: the plain-browser build cannot write the sidecar's opencode.json (no filesystem access).
    console.warn(
      "[opal:config] browser mode: opencode.json is not written; configure the external server yourself",
    )
    return false
  }
  const current = await native.readOpencodeConfig().catch(() => ({}))
  if (stableJSON(current) === stableJSON(config)) return false
  await native.writeOpencodeConfig(config)
  console.debug("[opal:config] opencode.json updated")
  if (options.reload !== false) {
    const client = await whenReady()
    await client.location
      .reload()
      .catch((error) => console.warn("[opal:config] reload failed", String(error)))
  }
  await refreshCatalog().catch(() => undefined)
  return true
}

/** Replaces the provider's stored key (credential `integrationID` = provider id). */
export async function setProviderKey(providerID: string, key: string) {
  const client = await whenReady()
  const existing = (await client.credential.list()).filter((c) => c.integrationID === providerID)
  for (const credential of existing) await client.credential.remove({ credentialID: credential.id })
  await client.credential.create({
    integrationID: providerID,
    label: "Opal",
    value: { type: "key", key },
    activate: true,
  })
}

export async function removeProviderKey(providerID: string) {
  const client = await whenReady()
  const existing = (await client.credential.list()).filter((c) => c.integrationID === providerID)
  for (const credential of existing) await client.credential.remove({ credentialID: credential.id })
}

export async function saveProvider(provider: ProviderConfig) {
  const clean = stripSecrets(provider)
  await updateSettings((s) => {
    const providers = s.providers.some((p) => p.id === clean.id)
      ? s.providers.map((p) => (p.id === clean.id ? clean : p))
      : [...s.providers, clean]
    return { ...s, providers }
  })
  if (!isMaskedKey(provider.apiKey)) await setProviderKey(provider.id, provider.apiKey!.trim())
  await applyConfig()
}

export async function deleteProvider(providerID: string) {
  await updateSettings((s) => ({
    ...s,
    providers: s.providers.filter((p) => p.id !== providerID),
    defaultModel: s.defaultModel?.providerID === providerID ? undefined : s.defaultModel,
  }))
  await removeProviderKey(providerID).catch((error) =>
    console.warn("[opal:providers] credential removal failed", String(error)),
  )
  await applyConfig()
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object" && "message" in error)
    return String((error as { message: unknown }).message)
  return String(error)
}

export async function testProvider(provider: ProviderConfig, modelID?: string) {
  const model = modelID ?? provider.models.find((m) => m.enabled !== false)?.id ?? provider.models[0]?.id
  if (!model) return { ok: false, message: "Add at least one model to test this provider." }
  try {
    await saveProvider(provider)
  } catch (error) {
    return { ok: false, message: `Could not save provider: ${errorMessage(error)}` }
  }
  const client = await whenReady()
  const started = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      client.experimental.generate.text({
        prompt: "Reply with the single word OK.",
        model: { providerID: provider.id, id: model },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`No response within ${TEST_TIMEOUT_MS / 1000}s`)),
          TEST_TIMEOUT_MS,
        )
      }),
    ])
    const latencyMs = Math.round(performance.now() - started)
    const text = result.text.trim().replace(/\s+/g, " ").slice(0, 120)
    return { ok: true, message: text ? `Model replied: ${text}` : "Connected (empty reply)", latencyMs }
  } catch (error) {
    return { ok: false, message: errorMessage(error), latencyMs: Math.round(performance.now() - started) }
  } finally {
    clearTimeout(timer)
  }
}

// ---------- import from the user's OpenCode CLI config ----------

type Json = Record<string, unknown>
const asObject = (v: unknown): Json | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined
const asString = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined)
const asNumber = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined

export function providerTypeFor(
  pkg: string | undefined,
  baseURL: string | undefined,
): ProviderConfig["type"] {
  const p = pkg ?? ""
  if (/openai-compatible/.test(p)) {
    if (baseURL && /:11434\b/.test(baseURL)) return "ollama"
    if (baseURL && /:1234\b/.test(baseURL)) return "lmstudio"
    return "openai-compatible"
  }
  if (/anthropic/.test(p)) return "anthropic"
  if (/openrouter/.test(p)) return "openrouter"
  if (/google/.test(p)) return "google"
  if (/ollama/.test(p)) return "ollama"
  if (/openai/.test(p)) return "openai"
  return "custom"
}

function mapModels(models: Json | undefined): ModelConfig[] {
  return Object.entries(models ?? {}).map(([id, raw]) => {
    const m = asObject(raw) ?? {}
    const limit = asObject(m.limit)
    const caps = asObject(m.capabilities)
    const modalities = asObject(m.modalities)
    const input = Array.isArray(modalities?.input)
      ? (modalities.input as unknown[])
      : Array.isArray(caps?.input)
        ? (caps.input as unknown[])
        : []
    const reasoning =
      typeof m.reasoning === "boolean" ? m.reasoning : asObject(caps?.reasoning)?.supported === true
    const tools =
      typeof m.tool_call === "boolean"
        ? m.tool_call
        : typeof caps?.tools === "boolean"
          ? (caps.tools as boolean)
          : undefined
    return {
      id: asString(m.id) ?? id,
      name: asString(m.name) ?? id,
      contextWindow: asNumber(limit?.context),
      maxOutputTokens: asNumber(limit?.output),
      capabilities: {
        tools,
        vision: input.includes("image") || m.attachment === true || undefined,
        reasoning: reasoning || undefined,
      },
      enabled: m.disabled === true ? false : true,
    }
  })
}

/**
 * Maps the CLI config's providers (v1 `provider` with npm/options, or v2 `providers` with
 * package/settings) to Opal providers. Literal API keys are returned separately; `{env:…}` /
 * `{file:…}` references cannot be resolved from the app and are skipped.
 */
export function mapCliProviders(config: Json): { provider: ProviderConfig; apiKey?: string }[] {
  const v1 = asObject(config.provider) ?? {}
  const v2 = asObject(config.providers) ?? {}
  const out: { provider: ProviderConfig; apiKey?: string }[] = []
  for (const [id, raw] of Object.entries({ ...v1, ...v2 })) {
    const entry = asObject(raw)
    if (!entry) continue
    const options = asObject(entry.options) ?? asObject(entry.settings) ?? {}
    const pkg = asString(entry.npm) ?? asString(entry.package)
    const baseURL = asString(options.baseURL) ?? asString(options.baseUrl)
    const key = asString(options.apiKey)
    const headers = asObject(options.headers) ?? asObject(entry.headers)
    const type = providerTypeFor(pkg, baseURL)
    const models = mapModels(asObject(entry.models))
    out.push({
      provider: {
        id,
        name: asString(entry.name) ?? id,
        type,
        ...(type === "custom" && pkg ? { package: pkg } : {}),
        ...(baseURL ? { baseURL } : {}),
        ...(headers
          ? {
              headers: Object.fromEntries(
                Object.entries(headers).filter(([, v]) => typeof v === "string"),
              ) as Record<string, string>,
            }
          : {}),
        models,
        enabled: true,
      },
      apiKey: key && !/^\{(env|file):/.test(key) ? key : undefined,
    })
  }
  return out
}

export async function importOpenCodeConfig(): Promise<{ imported: number }> {
  if (!isTauri()) throw new Error("Importing the OpenCode CLI config requires the desktop app")
  const config = await native.readUserCliConfig()
  if (!config) return { imported: 0 }
  const mapped = mapCliProviders(config).filter((m) => m.provider.models.length > 0 || m.provider.baseURL)
  if (!mapped.length) return { imported: 0 }
  await updateSettings((s) => {
    const byID = new Map(s.providers.map((p) => [p.id, p]))
    for (const { provider } of mapped) byID.set(provider.id, provider)
    return { ...s, providers: [...byID.values()] }
  })
  for (const { provider, apiKey } of mapped) if (apiKey) await setProviderKey(provider.id, apiKey)
  await applyConfig()
  return { imported: mapped.length }
}

export async function getPrompt(mode: ModeID) {
  await loadSettings()
  return { builtin: await builtinPrompt(mode), override: getSettings().promptOverrides[mode] }
}

export async function setPromptOverride(mode: ModeID, text: string | undefined) {
  await updateSettings((s) => {
    const promptOverrides = { ...s.promptOverrides }
    if (text === undefined || !text.trim()) delete promptOverrides[mode]
    else promptOverrides[mode] = text
    return { ...s, promptOverrides }
  })
  await applyConfig()
}
