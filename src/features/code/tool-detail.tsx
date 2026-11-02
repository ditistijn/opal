/** Code-surface rendering of expanded tool rows: inline diffs for edits, terminal-style shell output, subagent links. */
import { Network } from "lucide-react"
import type { ToolRowExtension } from "@/features/chat/ToolRow"
import type { FileDiff } from "@/lib/opencode/types"
import type { ToolPart } from "@/lib/runtime"
import { useCodeNav } from "./code-nav"
import { Counts } from "./DiffPane"
import { DiffView } from "./DiffView"

function fileDiffs(part: ToolPart): FileDiff[] | undefined {
  const files = part.metadata?.files
  if (!Array.isArray(files)) return undefined
  const valid = files.filter(
    (f): f is FileDiff => !!f && typeof f === "object" && typeof (f as FileDiff).patch === "string",
  )
  return valid.length ? valid : undefined
}

function str(v: unknown) {
  return typeof v === "string" ? v : undefined
}

function EditDetail({ files }: { files: FileDiff[] }) {
  return (
    <div className="space-y-2">
      {files.map((f) => (
        <div key={f.file} className="overflow-hidden rounded-lg border border-border bg-bg-elevated">
          <div className="flex h-8 items-center gap-2 border-b border-border px-3">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg">{f.file}</span>
            <Counts additions={f.additions} deletions={f.deletions} />
          </div>
          <div className="max-h-80 overflow-y-auto">
            <DiffView patch={f.patch} path={f.file} />
          </div>
        </div>
      ))}
    </div>
  )
}

function ShellDetail({ part }: { part: ToolPart }) {
  const command = str(part.input?.command) ?? part.inputText ?? ""
  const failed = part.status === "error"
  const exit = part.metadata?.exit
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg-muted font-mono text-[12px]">
      <div className="flex items-start gap-2 border-b border-border px-3 py-2">
        <span className="select-none text-fg-muted">$</span>
        <pre className="selectable min-w-0 flex-1 whitespace-pre-wrap break-all text-fg">{command}</pre>
        {typeof exit === "number" ? (
          <span className={exit === 0 ? "text-fg-faint" : "text-danger"}>exit {exit}</span>
        ) : null}
      </div>
      <pre
        className={`selectable max-h-72 overflow-auto whitespace-pre-wrap break-all px-3 py-2 ${failed ? "text-danger" : "text-fg-secondary"}`}
      >
        {failed ? part.error : part.output || (part.status === "completed" ? "(no output)" : "…")}
      </pre>
    </div>
  )
}

function SubagentDetail({ part }: { part: ToolPart }) {
  const childID = str(part.metadata?.sessionID)
  const show = useCodeNav((s) => s.showSubagent)
  return (
    <div className="rounded-lg border border-border bg-bg-muted px-3 py-2 text-[12.5px]">
      {str(part.input?.prompt) ? (
        <p className="selectable line-clamp-3 whitespace-pre-wrap text-fg-secondary">
          {str(part.input?.prompt)}
        </p>
      ) : null}
      {childID ? (
        <button
          type="button"
          onClick={() => show(childID)}
          className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-fg hover:text-accent"
        >
          <Network className="size-3.5" />
          Open subagent transcript
        </button>
      ) : null}
    </div>
  )
}

export const codeToolExtension: ToolRowExtension = {
  detail(part) {
    const files = fileDiffs(part)
    if (files) return <EditDetail files={files} />
    if (part.name === "shell" || part.name === "bash") return <ShellDetail part={part} />
    if (part.name === "subagent" || part.name === "task") return <SubagentDetail part={part} />
    return undefined
  },
}
