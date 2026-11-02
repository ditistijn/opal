/**
 * Agent modes registry + system prompt rendering.
 *
 * Each mode is an OpenCode agent Opal writes into opencode.json (see ./build.ts). The built-in prompts live in
 * resources/prompts/<mode>.md and are bundled at build time. Because `agents.<id>.system` REPLACES OpenCode's
 * base system prompt entirely, every prompt is complete on its own (harness notes + tool guidance + policy).
 */
import type { ModeID, Surface } from "@/lib/runtime/contracts"
import artifactPrompt from "../../../resources/prompts/artifact.md?raw"
import codePrompt from "../../../resources/prompts/code.md?raw"
import generalPrompt from "../../../resources/prompts/general.md?raw"
import researchPrompt from "../../../resources/prompts/research.md?raw"

export interface ModeDefinition {
  id: ModeID
  label: string
  /** lucide-react icon name (PascalCase). */
  icon: "Sparkles" | "Code" | "MessageCircle" | "Telescope"
  /** One-line description shown in mode pickers and written as the agent description. */
  description: string
  /** Surfaces where this mode is offered. */
  surfaces: Surface[]
  /** Agent color (hex, as required by OpenCode's Config.Agent color). */
  color: `#${string}`
}

export const MODE_IDS = ["artifact", "code", "general", "research"] as const satisfies readonly ModeID[]

export const MODES: Record<ModeID, ModeDefinition> = {
  artifact: {
    id: "artifact",
    label: "Artifacts",
    icon: "Sparkles",
    description:
      "Builds apps, visualizations, diagrams and documents as live artifacts and iterates on them.",
    surfaces: ["chat"],
    color: "#D97757",
  },
  general: {
    id: "general",
    label: "General",
    icon: "MessageCircle",
    description: "A concise, helpful assistant for questions, writing and analysis.",
    surfaces: ["chat"],
    color: "#87867F",
  },
  research: {
    id: "research",
    label: "Research",
    icon: "Telescope",
    description: "Searches the web, reads sources and writes cited, well-reasoned syntheses.",
    surfaces: ["chat"],
    color: "#3F8F5D",
  },
  code: {
    id: "code",
    label: "Code",
    icon: "Code",
    description: "Repository-aware software engineering: plans, edits, runs tests and keeps git tidy.",
    surfaces: ["code", "chat"],
    color: "#4D6FB4",
  },
}

/** The mode a new session starts in, per surface (when the user has not chosen one). */
export const DEFAULT_MODE_FOR_SURFACE: Record<Surface, ModeID> = { chat: "artifact", code: "code" }

export function modesForSurface(surface: Surface): ModeDefinition[] {
  return MODE_IDS.map((id) => MODES[id]).filter((mode) => mode.surfaces.includes(surface))
}

export function isModeID(value: unknown): value is ModeID {
  return typeof value === "string" && (MODE_IDS as readonly string[]).includes(value)
}

/** Built-in prompts, bundled from resources/prompts/*.md. */
export const BUILTIN_PROMPTS: Record<ModeID, string> = {
  artifact: artifactPrompt,
  code: codePrompt,
  general: generalPrompt,
  research: researchPrompt,
}

/** Placeholder an override may contain to include the built-in prompt (so users can extend rather than replace). */
export const BUILTIN_PLACEHOLDER = "{{builtin}}"

/**
 * Final system prompt for a mode.
 *  - no override / blank override → the built-in prompt
 *  - override containing `{{builtin}}` → the override with the built-in prompt substituted in place
 *  - any other override → the override verbatim (it replaces the built-in prompt entirely)
 * Line endings are normalized and surrounding whitespace trimmed, so output is deterministic.
 */
export function renderPrompt(_mode: ModeID, builtin: string, override?: string): string {
  const base = normalize(builtin)
  if (override === undefined || override.trim() === "") return base
  const text = normalize(override)
  if (!text.includes(BUILTIN_PLACEHOLDER)) return text
  return normalize(text.split(BUILTIN_PLACEHOLDER).join(base))
}

/** Render every mode's prompt from the built-ins and the user's overrides. */
export function renderAllPrompts(
  overrides: Partial<Record<ModeID, string>> = {},
  builtins: Record<ModeID, string> = BUILTIN_PROMPTS,
): Record<ModeID, string> {
  return Object.fromEntries(
    MODE_IDS.map((id) => [id, renderPrompt(id, builtins[id], overrides[id])]),
  ) as Record<ModeID, string>
}

function normalize(text: string) {
  return text.replace(/\r\n?/g, "\n").trim()
}
