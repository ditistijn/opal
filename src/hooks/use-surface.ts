import { runtime } from "@/lib/runtime"
import type { Surface } from "@/lib/runtime/contracts"

/** The active top-level surface: "chat" (chat, Projects, Artifacts) or "code" (agentic coding). */
export function useSurface() {
  const settings = runtime.useSettings()
  const surface: Surface = settings.lastSurface ?? "chat"
  return {
    surface,
    setSurface: (next: Surface) => runtime.updateSettings({ lastSurface: next }),
  }
}
