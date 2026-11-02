import { AppWindow, Code2, FileText, Image as ImageIcon, Table2 } from "lucide-react"
import type { ArtifactKind, ToolPart } from "@/lib/runtime"
import { runtime } from "@/lib/runtime"
import { cn } from "@/lib/utils"
import { baseToolName } from "./tool-labels"

const KIND: Record<ArtifactKind, { label: string; icon: typeof AppWindow }> = {
  html: { label: "Interactive artifact", icon: AppWindow },
  react: { label: "Interactive artifact", icon: AppWindow },
  markdown: { label: "Document", icon: FileText },
  mermaid: { label: "Diagram", icon: ImageIcon },
  svg: { label: "Image", icon: ImageIcon },
  json: { label: "Data", icon: Code2 },
  csv: { label: "Table", icon: Table2 },
  code: { label: "Code", icon: Code2 },
  unknown: { label: "Artifact", icon: AppWindow },
}

export function artifactIDFromTool(part: ToolPart): string | undefined {
  const meta = part.metadata?.artifactID ?? part.metadata?.id
  if (typeof meta === "string") return meta
  const input = part.input?.id ?? part.input?.artifactID
  return typeof input === "string" ? input : undefined
}

/** Inline card for artifact_create/update tool calls; opens the artifact panel. */
export function ArtifactCard({ part, sessionID }: { part: ToolPart; sessionID: string }) {
  const id = artifactIDFromTool(part)
  const view = runtime.useArtifact(id)
  const { artifactID: active, setActive } = runtime.useActiveArtifact(sessionID)
  const running = part.status === "running" || part.status === "streaming"
  const failed = part.status === "error"
  const kind = KIND[view?.kind ?? "unknown"]
  const Icon = kind.icon
  const title =
    view?.info.title ?? (typeof part.input?.title === "string" ? part.input.title : "Untitled artifact")
  const isActive = !!id && active === id
  const versions = view?.versions.length ?? 0

  return (
    <button
      type="button"
      disabled={!id || running}
      onClick={() => id && setActive(isActive ? undefined : id)}
      data-testid="artifact-card"
      className={cn(
        "my-3 flex w-full max-w-[440px] items-stretch overflow-hidden rounded-xl border bg-bg-elevated text-left transition-fast",
        isActive
          ? "border-border-strong ring-1 ring-border-strong"
          : "border-border hover:border-border-strong hover:bg-bg-muted/50",
        (running || !id) && "cursor-default",
      )}
    >
      <span className="flex w-14 shrink-0 items-center justify-center border-r border-border bg-bg-muted text-fg-muted">
        <Icon className={cn("size-5", running && "animate-pulse")} />
      </span>
      <span className="flex min-w-0 flex-col justify-center px-3.5 py-2.5">
        <span className="truncate text-[14px] font-medium text-fg">{title}</span>
        <span className={cn("text-[12.5px] text-fg-muted", running && "opal-shimmer")}>
          {failed
            ? (part.error ?? "Failed")
            : running
              ? baseToolName(part.name) === "artifact_update"
                ? "Updating…"
                : "Creating…"
              : `${kind.label}${versions > 1 ? ` · Version ${versions}` : ""} · ${isActive ? "Open" : "Click to open"}`}
        </span>
      </span>
    </button>
  )
}
