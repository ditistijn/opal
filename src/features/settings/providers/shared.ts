import type { ProviderConfig } from "@/lib/runtime/contracts"
import { isTauri } from "@/lib/utils"

export const TYPE_LABELS: Record<ProviderConfig["type"], string> = {
  "openai-compatible": "OpenAI-compatible",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  custom: "Custom package",
}

export function hostLabel(url: string | undefined) {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname
  } catch {
    return url
  }
}

export async function openExternal(url: string) {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener")
    await openUrl(url)
    return
  }
  window.open(url, "_blank", "noopener,noreferrer")
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return typeof error === "string" ? error : "Something went wrong."
}
