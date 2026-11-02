import { AppWindow, Code2, MessageSquare, Telescope, type LucideIcon } from "lucide-react"
import type { ModeID } from "@/lib/runtime"

export const MODES: { id: ModeID; label: string; description: string; icon: LucideIcon }[] = [
  { id: "artifact", label: "Artifact", description: "Builds documents, apps and visuals", icon: AppWindow },
  { id: "code", label: "Code", description: "Writes and runs code in the sandbox", icon: Code2 },
  { id: "general", label: "General", description: "Everyday questions and writing", icon: MessageSquare },
  { id: "research", label: "Research", description: "Searches the web and cites sources", icon: Telescope },
]

export function modeInfo(id: ModeID | undefined) {
  return MODES.find((m) => m.id === id) ?? MODES[0]
}
