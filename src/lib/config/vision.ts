/**
 * Image fallback: a "vision" subagent pinned to an image-capable model.
 *
 * When a chat runs on a model without image input, dropped images are not sent as file parts (non-vision
 * providers reject or silently drop them). They stay saved in the conversation's uploads folder, and the prompt
 * tells the chat model to call OpenCode's `subagent` tool with `agent: "vision"`. That child session runs on
 * `settings.imageFallback.model`, opens the image with the `read` tool (which returns images as file parts —
 * OpenCode 2.2.5 ReadTool) and answers in text.
 *
 * Verified against OpenCode v2.2.5: Config.Agent accepts `model` ("providerID/modelID") and
 * `mode: "subagent"`; the subagent tool takes `{ agent, description, prompt }`.
 */
import type { ModelInfo, ModelRef } from "@/lib/opencode/types"
import type { AppSettings } from "@/lib/runtime/contracts"
import { formatModelRef, isValidModelID, sanitizeProviderID } from "./ids"

export const VISION_AGENT_ID = "vision"

export const VISION_AGENT_DESCRIPTION =
  "Looks at image files for models that cannot see images. Give it the image path(s) and exactly what you " +
  "need to know (describe, transcribe text, read a chart, compare…); it answers in text."

export const VISION_SYSTEM_PROMPT = `You are an image-reading helper for another AI model that cannot see images.

You receive a request naming one or more image files and what the other model needs to know.
1. Open every named image with the read tool (pass its path exactly as given).
2. Answer the request from what you actually see. Be thorough and concrete: transcribe all visible text
   verbatim (code, error messages, UI labels, numbers), describe layout, charts, tables, diagrams, people and
   objects as relevant. Reproduce tables as markdown tables.
3. If the request is vague, give a complete description that would let someone who cannot see the image
   answer follow-up questions about it.
4. Say plainly when something is unreadable, cut off or ambiguous. Never guess or invent details.

Reply with the answer only; the other model relays it to the user.`

/** Whether a file's mime type is an image the vision helper can open (SVG is text, read as such). */
export function isRasterImage(mime: string | undefined) {
  return !!mime && mime.startsWith("image/") && mime !== "image/svg+xml"
}

/** Raster image by mime type, or by extension when the drop carried none (Tauri path drops). */
export function looksLikeImage(file: { name: string; mime?: string }) {
  if (file.mime) return isRasterImage(file.mime)
  return /\.(png|jpe?g|gif|webp|heic|bmp|tiff?)$/i.test(file.name)
}

/** Whether a catalog model accepts image input. Unknown models are assumed to (the old behavior). */
export function modelSeesImages(models: readonly ModelInfo[], ref: ModelRef | undefined) {
  if (!ref) return true
  const info = models.find((m) => m.providerID === ref.providerID && m.id === ref.id)
  return info ? info.capabilities.input.includes("image") : true
}

/** Enabled chat models with image input — the choices for the fallback model. */
export function visionModels(models: readonly ModelInfo[]) {
  return models.filter(
    (m) =>
      m.enabled &&
      (m.type === undefined || m.type === "chat") &&
      m.capabilities.input.includes("image") &&
      m.capabilities.tools,
  )
}

/**
 * The model to adopt for the fallback when none is set (or the set one disappeared): an image-capable model of
 * the user's default provider first, then any image-capable model.
 */
export function pickVisionModel(
  models: readonly ModelInfo[],
  current: ModelRef | undefined,
  prefer: ModelRef | undefined,
): ModelRef | undefined {
  const candidates = visionModels(models)
  if (current && candidates.some((m) => m.providerID === current.providerID && m.id === current.id))
    return current
  const pick =
    (prefer && candidates.find((m) => m.providerID === prefer.providerID && m.id === prefer.id)) ??
    (prefer && candidates.find((m) => m.providerID === prefer.providerID)) ??
    candidates[0]
  return pick ? { providerID: pick.providerID, id: pick.id } : undefined
}

/** The `model` written for the vision agent, or undefined when the fallback is off / unusable. */
export function visionAgentModel(
  settings: Pick<AppSettings, "imageFallback">,
  disabledProviders: ReadonlySet<string>,
): string | undefined {
  const { enabled, model } = settings.imageFallback
  if (!enabled || !model?.providerID || !model.id || !isValidModelID(model.id)) return undefined
  const providerID = sanitizeProviderID(model.providerID)
  if (disabledProviders.has(providerID)) return undefined
  return formatModelRef({ providerID, id: model.id })
}

/**
 * The line added to the attachment note when images go to the helper instead of the chat model.
 * `available` = the vision agent exists on the server.
 */
export function visionNote(available: boolean) {
  return available
    ? `Your model cannot see images, so the images above were not shown to you. To look at one, call the subagent tool with agent "${VISION_AGENT_ID}", a short description, and a prompt that names the image path(s) and says exactly what you need to know (for example: "Describe uploads/photo.png in detail and transcribe any text"). Use its answer to reply. Do not read the image yourself.`
    : "Your model cannot see images and no image-capable helper is configured, so the images above were not shown to you. Tell the user you cannot view images with this model, and suggest switching to a model with vision or setting an image fallback model in Settings → General."
}
