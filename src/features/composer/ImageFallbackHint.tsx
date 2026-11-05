import { EyeOff } from "lucide-react"
import { looksLikeImage, modelSeesImages } from "@/lib/config/vision"
import type { ModelRef } from "@/lib/opencode/types"
import { runtime } from "@/lib/runtime"
import { isTauri } from "@/lib/utils"

/**
 * Shown under the attachment chips when images are attached but the chat's model has no image input:
 * says which model will look at them instead (src/lib/config/vision.ts), or how to set one up.
 */
export function ImageFallbackHint({
  files,
  sessionID,
  model,
}: {
  files: readonly { name: string; mime?: string }[]
  sessionID?: string
  model?: ModelRef
}) {
  const models = runtime.useModels()
  const settings = runtime.useSettings()
  const session = runtime.useSession(sessionID)
  const effective = (sessionID ? session?.model : undefined) ?? model ?? settings.defaultModel
  // The browser build sends images inline (no saved path the helper could open), so nothing changes there.
  if (!isTauri() || !files.some(looksLikeImage) || modelSeesImages(models, effective)) return null

  const fallback = settings.imageFallback.enabled ? settings.imageFallback.model : undefined
  const fallbackName =
    fallback &&
    (models.find((m) => m.providerID === fallback.providerID && m.id === fallback.id)?.name ?? fallback.id)

  return (
    <p className="flex items-center gap-1.5 px-4 pt-2 text-xs text-fg-muted" role="note">
      <EyeOff className="size-3.5 shrink-0" aria-hidden />
      {fallbackName
        ? `This model can't see images — ${fallbackName} will look at them for it.`
        : "This model can't see images. Pick a vision model, or set an image fallback in Settings → General."}
    </p>
  )
}
