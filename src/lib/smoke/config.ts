/** The OPAL_SMOKE configuration (see scripts/smoke-mac.sh and docs/VERIFICATION.md "Automated acceptance run"). */
import type { ModelRef } from "@/lib/opencode/types"
import type { ProviderConfig } from "@/lib/runtime/contracts"

export type SmokePhase = "create" | "reopen"

export interface SmokeConfig {
  /** Report name → `<logs>/smoke-<name>.json`. */
  name: string
  phase: SmokePhase
  prompt1: string
  prompt2: string
  model?: ModelRef
  /** Import providers from ~/.config/opencode/opencode.json (how a CLI-configured proxy gets in). */
  importCliConfig: boolean
  /** Alternative to `importCliConfig`: a provider saved through `runtime.saveProvider`. */
  provider?: ProviderConfig
  /** Per-turn timeout (and the budget for each long wait). */
  timeoutMs: number
  /** Stop the sidecar and exit the app once the report is written. */
  exit: boolean
  /** reopen: the conversation and artifact created by the "create" phase. */
  sessionID?: string
  artifactID?: string
}

export const DEFAULT_PROMPT1 = "Create a beautiful interactive network monitoring dashboard."
export const DEFAULT_PROMPT2 = "Add a latency graph and make the dashboard dark."
export const DEFAULT_TIMEOUT_MS = 900_000

const NAME = /^[A-Za-z0-9_-]{1,64}$/

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined
}

/** Validates the untrusted OPAL_SMOKE value; throws with a readable message. */
export function parseSmokeConfig(raw: unknown): SmokeConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("OPAL_SMOKE must be a JSON object")
  const v = raw as Record<string, unknown>
  const name = str(v.name) ?? "smoke"
  if (!NAME.test(name)) throw new Error(`OPAL_SMOKE.name must match ${NAME}`)
  const phase = v.phase ?? "create"
  if (phase !== "create" && phase !== "reopen")
    throw new Error(`OPAL_SMOKE.phase must be "create" or "reopen"`)
  let model: ModelRef | undefined
  if (v.model !== undefined) {
    const m = v.model as Record<string, unknown> | null
    const providerID = str(m?.providerID)
    const id = str(m?.id)
    if (!providerID || !id) throw new Error("OPAL_SMOKE.model needs providerID and id")
    model = { providerID, id }
  }
  const timeout = Number(v.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const config: SmokeConfig = {
    name,
    phase,
    prompt1: str(v.prompt1) ?? DEFAULT_PROMPT1,
    prompt2: str(v.prompt2) ?? DEFAULT_PROMPT2,
    model,
    importCliConfig: v.importCliConfig === true,
    provider: v.provider && typeof v.provider === "object" ? (v.provider as ProviderConfig) : undefined,
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? timeout : DEFAULT_TIMEOUT_MS,
    exit: v.exit === true,
    sessionID: str(v.sessionID),
    artifactID: str(v.artifactID),
  }
  if (phase === "reopen" && (!config.sessionID || !config.artifactID))
    throw new Error("OPAL_SMOKE phase reopen needs sessionID and artifactID")
  return config
}
