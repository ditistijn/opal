import type { ModelInfo, ModelRef } from "@/lib/opencode/types"

/** Compact token count for labels: 1_000_000 → "1M", 262_144 → "262K", 8_192 → "8K". */
export function formatTokens(value: number | undefined): string {
  if (!value || value <= 0) return ""
  if (value >= 1_000_000) {
    const m = value / 1_000_000
    return `${Number.isInteger(Math.round(m * 10) / 10) ? Math.round(m) : (Math.round(m * 10) / 10).toString()}M`
  }
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(value)
}

/** Editable representation: exact when not a round multiple ("32768"), compact otherwise ("128K", "1M"). */
export function formatTokenInput(value: number | undefined): string {
  if (value === undefined) return ""
  if (value >= 1_000_000 && value % 100_000 === 0) return `${value / 1_000_000}M`
  if (value >= 1_000 && value % 1_000 === 0) return `${value / 1_000}K`
  return String(value)
}

/** Parses "128k", "1M", "1.5m", "32,768", "32768". Empty → undefined; garbage → NaN. */
export function parseTokenInput(input: string): number | undefined {
  const text = input.trim().replace(/[,_\s]/g, "")
  if (!text) return undefined
  const match = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(text)
  if (!match) return Number.NaN
  const base = Number.parseFloat(match[1])
  const unit = match[2].toLowerCase()
  return Math.round(unit === "m" ? base * 1_000_000 : unit === "k" ? base * 1_000 : base)
}

export function sameModel(a: ModelRef | undefined, b: { providerID: string; id: string } | undefined) {
  return Boolean(a && b && a.providerID === b.providerID && a.id === b.id)
}

export function modelCapabilities(model: ModelInfo) {
  return {
    tools: model.capabilities.tools,
    vision: model.capabilities.input.includes("image"),
    reasoning: model.variants.length > 0,
  }
}

/** Chat models the selector offers: enabled, chat-typed (unset = chat). */
export function selectableModels(models: ModelInfo[]) {
  return models.filter((model) => model.enabled && (model.type === undefined || model.type === "chat"))
}
