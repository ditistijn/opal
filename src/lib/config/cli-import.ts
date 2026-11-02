/**
 * Pure parser for the user's own OpenCode CLI config (~/.config/opencode/opencode.json) → Opal providers.
 * Used by the runtime's `importOpenCodeConfig()`: it reads the file via Rust, calls this, stores each returned
 * `apiKey` in OpenCode's credential store (integrationID = provider.id) and saves the providers WITHOUT the key.
 *
 * Supports both shapes (verified against core/src/config/normalize.ts + v1/config/migrate.ts):
 *  - v1: `provider: { id: { npm, name, api?, options: { baseURL, apiKey, headers, ...}, models: { id: { name,
 *        limit: {context, output}, attachment?, reasoning?, tool_call? } } } }`
 *  - v2: `providers: { id: { name, package, settings: { baseURL, apiKey }, headers, models: { id: { name, limit,
 *        capabilities } } } }`
 * `{env:VAR}` / `{file:…}` placeholders are not resolved — such keys are skipped (the user re-enters them).
 */
import type { ModelConfig, ProviderConfig } from "@/lib/runtime/contracts"
import { uniqueProviderID } from "./ids"

export interface ImportedProvider {
  provider: ProviderConfig
  /** Literal API key found in the file (never persisted by Opal outside the credential store). */
  apiKey?: string
}

const TYPE_FOR_PACKAGE: Record<string, ProviderConfig["type"]> = {
  "@ai-sdk/openai-compatible": "openai-compatible",
  "@ai-sdk/openai": "openai",
  "@ai-sdk/anthropic": "anthropic",
  "@ai-sdk/google": "google",
  "@openrouter/ai-sdk-provider": "openrouter",
}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)
const int = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined

export function parseOpenCodeCliConfig(
  config: unknown,
  existingIDs: Iterable<string> = [],
): ImportedProvider[] {
  if (!isObject(config)) return []
  const taken = new Set(existingIDs)
  const sources: [string, Json, "v1" | "v2"][] = []
  if (isObject(config.provider))
    for (const [id, value] of Object.entries(config.provider))
      if (isObject(value)) sources.push([id, value, "v1"])
  if (isObject(config.providers))
    for (const [id, value] of Object.entries(config.providers))
      if (isObject(value)) sources.push([id, value, "v2"])

  const result: ImportedProvider[] = []
  for (const [sourceID, raw, version] of sources) {
    const options = isObject(version === "v1" ? raw.options : raw.settings)
      ? ((version === "v1" ? raw.options : raw.settings) as Json)
      : {}
    const rawPackage = str(version === "v1" ? raw.npm : raw.package)
    const pkg = rawPackage?.replace(/^aisdk:/, "")
    const baseURL = str(version === "v1" ? (raw.api ?? options.baseURL) : options.baseURL)
    const headersSource = version === "v1" ? options.headers : raw.headers
    const headers = isObject(headersSource)
      ? Object.fromEntries(
          Object.entries(headersSource).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : undefined
    const type: ProviderConfig["type"] = pkg
      ? (TYPE_FOR_PACKAGE[pkg] ?? "custom")
      : guessType(sourceID, baseURL)
    const models = isObject(raw.models)
      ? Object.entries(raw.models).flatMap(([modelID, value]) =>
          isObject(value) ? [parseModel(modelID, value, version)] : [],
        )
      : []
    const id = uniqueProviderID(sourceID, taken)
    taken.add(id)
    const provider: ProviderConfig = {
      id,
      name: str(raw.name) ?? sourceID,
      type,
      ...(type === "custom" && pkg ? { package: pkg } : {}),
      ...(baseURL ? { baseURL } : {}),
      ...(headers && Object.keys(headers).length ? { headers } : {}),
      models,
      enabled: true,
    }
    const key = str(options.apiKey)
    const literalKey = key && !/^\{(env|file):/.test(key) ? key : undefined
    result.push(literalKey ? { provider, apiKey: literalKey } : { provider })
  }
  return result
}

function guessType(id: string, baseURL: string | undefined): ProviderConfig["type"] {
  if (id === "anthropic") return "anthropic"
  if (id === "openai") return "openai"
  if (id === "google") return "google"
  if (id === "openrouter") return "openrouter"
  if (id === "ollama" || baseURL?.includes(":11434")) return "ollama"
  if (id === "lmstudio" || baseURL?.includes(":1234")) return "lmstudio"
  return "openai-compatible"
}

function parseModel(id: string, raw: Json, version: "v1" | "v2"): ModelConfig {
  const limit = isObject(raw.limit) ? raw.limit : {}
  const capabilities = isObject(raw.capabilities) ? raw.capabilities : undefined
  const input = Array.isArray(capabilities?.input) ? capabilities.input : undefined
  const reasoning = isObject(capabilities?.reasoning) ? capabilities.reasoning.supported : undefined
  const caps =
    version === "v1"
      ? {
          ...(typeof raw.tool_call === "boolean" ? { tools: raw.tool_call } : {}),
          ...(typeof raw.attachment === "boolean" ? { vision: raw.attachment } : {}),
          ...(typeof raw.reasoning === "boolean" ? { reasoning: raw.reasoning } : {}),
        }
      : {
          ...(typeof capabilities?.tools === "boolean" ? { tools: capabilities.tools } : {}),
          ...(input ? { vision: input.includes("image") } : {}),
          ...(typeof reasoning === "boolean" ? { reasoning } : {}),
        }
  return {
    id,
    name: str(raw.name) ?? id,
    ...(int(limit.context) ? { contextWindow: int(limit.context) } : {}),
    ...(int(limit.output) ? { maxOutputTokens: int(limit.output) } : {}),
    ...(Object.keys(caps).length ? { capabilities: caps } : {}),
    enabled: raw.disabled !== true,
  }
}
