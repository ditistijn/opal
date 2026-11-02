import { Download, ExternalLink, FolderOpen, Files } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tip } from "@/components/ui/tooltip"
import { fileIcon } from "@/features/composer/AttachmentChip"
import { formatBytes } from "@/features/composer/drafts"
import { runtime } from "@/lib/runtime"
import { formatRelativeTime } from "@/lib/utils"
import { ActionButton } from "./MessageActions"

/** Header button + drawer listing the files in the conversation sandbox. */
export function FilesDrawer({ sessionID }: { sessionID: string }) {
  const files = runtime.useSessionFiles(sessionID)
  const sorted = [...files].sort((a, b) => b.modified - a.modified)
  return (
    <Popover>
      <Tip label="Files in this chat">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Files"
            className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-secondary transition-fast hover:bg-bg-muted hover:text-fg data-[state=open]:bg-bg-muted data-[state=open]:text-fg"
          >
            <Files className="size-4" />
            {files.length ? <span className="tabular-nums">{files.length}</span> : null}
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-[340px] p-0">
        <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
          <span className="text-[13px] font-medium">Files</span>
          <span className="text-[12px] text-fg-muted">
            {files.length ? `${files.length} in this chat` : ""}
          </span>
        </div>
        {sorted.length === 0 ? (
          <p className="px-3.5 py-6 text-center text-[13px] text-fg-muted">
            Files you add or Opal creates will appear here.
          </p>
        ) : (
          <ul className="max-h-[360px] overflow-y-auto p-1" aria-label="Session files">
            {sorted.map((f) => {
              const Icon = fileIcon(f.name)
              return (
                <li
                  key={f.path}
                  className="group/file flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-bg-muted"
                >
                  <Icon className="size-4 shrink-0 text-fg-muted" />
                  <button
                    type="button"
                    onClick={() => runtime.openPath(f.path)}
                    className="flex min-w-0 flex-1 flex-col text-left"
                    title={f.path}
                  >
                    <span className="truncate text-[13px] text-fg">{f.name}</span>
                    <span className="text-[11.5px] text-fg-muted">
                      {formatBytes(f.size)} · {formatRelativeTime(f.modified)}
                    </span>
                  </button>
                  <div className="flex opacity-0 transition-opacity group-hover/file:opacity-100 focus-within:opacity-100">
                    <ActionButton label="Show in Finder" onClick={() => runtime.revealPath(f.path)}>
                      <FolderOpen />
                    </ActionButton>
                    <ActionButton label="Open" onClick={() => runtime.openPath(f.path)}>
                      <ExternalLink />
                    </ActionButton>
                    <ActionButton label="Save as…" onClick={() => runtime.saveFileAs(f.path)}>
                      <Download />
                    </ActionButton>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
