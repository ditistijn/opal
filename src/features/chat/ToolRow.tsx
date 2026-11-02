import { AlertCircle, ChevronRight } from "lucide-react"
import { createContext, useContext, useState, type ReactNode } from "react"
import type { ToolPart } from "@/lib/runtime"
import { cn } from "@/lib/utils"
import { toolLabel } from "./tool-labels"

function pretty(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * Optional per-surface extension: the Code surface renders edit diffs / subagent links in place of the
 * generic input/output block. Without a provider ToolRow behaves exactly as before.
 */
export interface ToolRowExtension {
  /** Expanded content for a tool part; return undefined to use the default input/output view. */
  detail?(part: ToolPart): ReactNode | undefined
}
export const ToolRowContext = createContext<ToolRowExtension | undefined>(undefined)

/** Sums the +/- line counts of file diffs in edit/write/patch tool metadata (`metadata.files`). */
export function toolFileStats(part: Pick<ToolPart, "metadata">) {
  const files = part.metadata?.files
  if (!Array.isArray(files) || !files.length) return undefined
  let additions = 0
  let deletions = 0
  for (const f of files as { additions?: unknown; deletions?: unknown }[]) {
    if (typeof f?.additions === "number") additions += f.additions
    if (typeof f?.deletions === "number") deletions += f.deletions
  }
  return { additions, deletions, count: files.length }
}

/** Compact tool activity row with a chevron that reveals input/output. */
export function ToolRow({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false)
  const extension = useContext(ToolRowContext)
  const stats = toolFileStats(part)
  const custom = open ? extension?.detail?.(part) : undefined
  const label = toolLabel(part)
  const Icon = label.icon
  const running = part.status === "running" || part.status === "streaming"
  const failed = part.status === "error"
  const input = part.input ?? (part.inputText ? { raw: part.inputText } : undefined)

  return (
    <div className="my-1.5" data-testid="tool-row" data-status={part.status}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group/tool flex h-7 max-w-full items-center gap-2 rounded-md pr-2 text-left text-[13.5px] text-fg-secondary transition-colors duration-[120ms] hover:text-fg"
      >
        {failed ? (
          <AlertCircle className="size-4 shrink-0 text-danger" />
        ) : (
          <Icon className="size-4 shrink-0 text-fg-muted" />
        )}
        <span className={cn("shrink-0", running && "opal-shimmer")}>
          {running ? label.running : label.done}
        </span>
        {label.detail ? (
          <span className="min-w-0 truncate font-mono text-[12px] text-fg-muted">{label.detail}</span>
        ) : null}
        {stats ? (
          <span className="shrink-0 font-mono text-[11.5px] tabular-nums" aria-label="Line changes">
            <span className="text-success">+{stats.additions}</span>{" "}
            <span className="text-danger">−{stats.deletions}</span>
          </span>
        ) : null}
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-fg-muted opacity-0 transition-[transform,opacity] duration-[120ms] group-hover/tool:opacity-100",
            open && "rotate-90 opacity-100",
          )}
        />
      </button>
      {custom !== undefined ? (
        <div className="opal-fade-in ml-6 mt-1">{custom}</div>
      ) : open ? (
        <div className="opal-fade-in ml-6 mt-1 overflow-hidden rounded-lg border border-border bg-bg-muted text-[12px]">
          {input ? (
            <div className="border-b border-border px-3 py-2">
              <div className="mb-1 font-sans text-[11px] font-medium text-fg-muted">Input</div>
              <pre className="selectable max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-fg-secondary">
                {pretty(input)}
              </pre>
            </div>
          ) : null}
          <div className="px-3 py-2">
            <div className="mb-1 font-sans text-[11px] font-medium text-fg-muted">
              {failed ? "Error" : "Output"}
            </div>
            <pre
              className={cn(
                "selectable max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono",
                failed ? "text-danger" : "text-fg-secondary",
              )}
            >
              {failed ? part.error : part.output || (running ? "…" : "(no output)")}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  )
}
