/**
 * Provider form model: creating a draft from a preset, validating it, and normalizing it for saving.
 * Pure — shared by the Settings UI and tests.
 */
import type { ModelConfig, OpenAIApi, ProviderConfig } from "@/lib/runtime/contracts"
import { supportsApiChoice } from "./build"
import { isValidModelID, isValidProviderID, uniqueProviderID } from "./ids"
import type { ProviderPreset } from "./provider-presets"

export interface HeaderRow {
  key: string
  value: string
}

export interface ProviderDraft {
  id: string
  /** False once the user (or an existing saved provider) fixed the id; true while it follows the name. */
  idFollowsName: boolean
  name: string
  type: ProviderConfig["type"]
  package: string
  baseURL: string
  /** Typed in the form only; never stored in settings.json. Empty = keep the stored credential. */
  apiKey: string
  headers: HeaderRow[]
  models: ModelConfig[]
  enabled: boolean
  /** Fail streams that end without finish_reason (off = tolerate proxies that drop the final chunk). */
  strictStreaming: boolean
  /** Wire protocol for OpenAI-compatible endpoints (ignored for other types). */
  api: OpenAIApi
}

export type DraftErrors = Partial<
  Record<"id" | "name" | "baseURL" | "package" | "apiKey" | "headers" | "models", string>
> & {
  modelRows?: Record<number, string>
}

export function draftFromPreset(preset: ProviderPreset, takenIDs: Iterable<string>): ProviderDraft {
  const taken = [...takenIDs]
  const id = uniqueProviderID(preset.id === "custom" ? "custom" : preset.id, taken)
  return {
    id,
    idFollowsName: preset.id === "custom",
    name: preset.id === "custom" ? "" : taken.includes(preset.id) ? `${preset.name} 2` : preset.name,
    type: preset.type,
    package: preset.package ?? "",
    baseURL: preset.baseURL,
    apiKey: "",
    headers: [],
    models: preset.models.map((model) => ({ ...model, capabilities: { ...model.capabilities } })),
    enabled: true,
    strictStreaming: false,
    api: "chat",
  }
}

export function draftFromProvider(provider: ProviderConfig): ProviderDraft {
  return {
    id: provider.id,
    idFollowsName: false,
    name: provider.name,
    type: provider.type,
    package: provider.package ?? "",
    baseURL: provider.baseURL ?? "",
    apiKey: "",
    headers: Object.entries(provider.headers ?? {}).map(([key, value]) => ({ key, value })),
    models: provider.models.map((model) => ({ ...model, capabilities: { ...model.capabilities } })),
    enabled: provider.enabled,
    strictStreaming: provider.strictStreaming ?? false,
    api: provider.api ?? "chat",
  }
}

/** Types whose endpoint must be given (others have a package default). */
export function requiresBaseURL(type: ProviderConfig["type"]) {
  return type === "openai-compatible" || type === "custom"
}

export function validateDraft(
  draft: ProviderDraft,
  context: { isNew: boolean; takenIDs: Iterable<string>; requiresKey?: boolean; hasStoredKey?: boolean },
): DraftErrors {
  const errors: DraftErrors = {}
  if (!draft.name.trim()) errors.name = "Give this provider a name."
  if (context.isNew) {
    if (!isValidProviderID(draft.id))
      errors.id = "Use lowercase letters, digits, “-”, “_” or “.” (no spaces, “/” or “#”)."
    else if (new Set(context.takenIDs).has(draft.id)) errors.id = "Another provider already uses this ID."
  }
  const url = draft.baseURL.trim()
  if (url) {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        errors.baseURL = "The endpoint must start with http:// or https://."
    } catch {
      errors.baseURL = "Enter a full URL, for example https://api.example.com/v1."
    }
  } else if (requiresBaseURL(draft.type)) {
    errors.baseURL = "An endpoint URL is required for OpenAI-compatible providers."
  }
  if (draft.type === "custom" && !draft.package.trim())
    errors.package = "Enter the provider package (for example @ai-sdk/mistral)."
  if (context.isNew && context.requiresKey && !draft.apiKey.trim() && !context.hasStoredKey)
    errors.apiKey = "This provider needs an API key."
  const headerKeys = draft.headers.map((row) => row.key.trim()).filter(Boolean)
  if (draft.headers.some((row) => !row.key.trim() && row.value.trim()))
    errors.headers = "Every header needs a name."
  else if (new Set(headerKeys.map((key) => key.toLowerCase())).size !== headerKeys.length)
    errors.headers = "Header names must be unique."
  else if (headerKeys.some((key) => !/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(key)))
    errors.headers = "Header names can't contain spaces or special characters."

  const rows: Record<number, string> = {}
  const seen = new Set<string>()
  draft.models.forEach((model, index) => {
    const id = model.id.trim()
    if (!id) rows[index] = "Model ID is required."
    else if (!isValidModelID(id)) rows[index] = "Model IDs can't contain “#”."
    else if (seen.has(id)) rows[index] = "Duplicate model ID."
    else if (
      model.contextWindow !== undefined &&
      !(Number.isInteger(model.contextWindow) && model.contextWindow > 0)
    )
      rows[index] = "Context window must be a positive whole number."
    else if (
      model.maxOutputTokens !== undefined &&
      !(Number.isInteger(model.maxOutputTokens) && model.maxOutputTokens > 0)
    )
      rows[index] = "Max output must be a positive whole number."
    seen.add(id)
  })
  if (Object.keys(rows).length > 0) errors.modelRows = rows
  if (
    draft.models.length === 0 &&
    draft.type !== "anthropic" &&
    draft.type !== "openai" &&
    draft.type !== "google" &&
    draft.type !== "openrouter"
  )
    errors.models = "Add at least one model (or use “Fetch models”)."
  return errors
}

export function hasErrors(errors: DraftErrors) {
  return (
    Object.keys(errors).some((key) => key !== "modelRows") || Object.keys(errors.modelRows ?? {}).length > 0
  )
}

/** The ProviderConfig to pass to runtime.saveProvider. `apiKey` is included only when the user typed one. */
export function draftToProvider(draft: ProviderDraft): ProviderConfig {
  const headers = Object.fromEntries(
    draft.headers.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value] as const),
  )
  const provider: ProviderConfig = {
    id: draft.id,
    name: draft.name.trim(),
    type: draft.type,
    models: draft.models.map((model) => ({
      ...model,
      id: model.id.trim(),
      name: model.name.trim() || model.id.trim(),
    })),
    enabled: draft.enabled,
  }
  if (draft.strictStreaming) provider.strictStreaming = true
  if (draft.api === "responses" && supportsApiChoice({ type: draft.type, package: draft.package }))
    provider.api = "responses"
  if (draft.type === "custom" && draft.package.trim()) provider.package = draft.package.trim()
  if (draft.baseURL.trim()) provider.baseURL = draft.baseURL.trim().replace(/\/+$/, "")
  if (Object.keys(headers).length > 0) provider.headers = headers
  if (draft.apiKey.trim()) provider.apiKey = draft.apiKey.trim()
  return provider
}

/** "••••1a2b" — the only form in which a key is ever rendered. */
export function maskKey(key: string | undefined) {
  if (!key) return ""
  return `••••${key.slice(-4)}`
}

export function emptyModel(): ModelConfig {
  return { id: "", name: "", capabilities: { tools: true, vision: false, reasoning: false }, enabled: true }
}
