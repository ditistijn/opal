import { ChevronDown, FolderClosed, PanelRight, Pencil, Star, StarOff, Trash2 } from "lucide-react"
import { useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tip } from "@/components/ui/tooltip"
import { DeleteChatDialog } from "@/features/sidebar/DeleteChatDialog"
import { sessionTitle } from "@/features/sidebar/group-sessions"
import { MOD } from "@/features/sidebar/Sidebar"
import { RenameInput } from "@/features/sidebar/SessionRow"
import type { SessionInfo } from "@/lib/opencode/types"
import { runtime } from "@/lib/runtime"
import { cn } from "@/lib/utils"
import { FilesDrawer } from "./FilesDrawer"
import { useNav } from "./nav-store"

export function ConversationHeader({
  session,
  artifactOpen,
  hasArtifacts,
  onToggleArtifact,
}: {
  session: SessionInfo
  artifactOpen: boolean
  hasArtifacts: boolean
  onToggleArtifact(): void
}) {
  const go = useNav((s) => s.go)
  const settings = runtime.useSettings()
  const meta = runtime.getOpalMetadata(session)
  const project = meta.projectID ? settings.projects.find((p) => p.id === meta.projectID) : undefined
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const title = sessionTitle(session)

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 px-3">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {project ? (
          <>
            <button
              type="button"
              onClick={() => go({ kind: "project", projectID: project.id })}
              className="flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-muted transition-fast hover:bg-bg-muted hover:text-fg"
            >
              <FolderClosed className="size-4 shrink-0" />
              <span className="truncate">{project.name}</span>
            </button>
            <span className="text-fg-faint">/</span>
          </>
        ) : null}
        {renaming ? (
          <div className="w-72">
            <RenameInput
              initial={session.title ?? ""}
              onDone={(t) => {
                setRenaming(false)
                if (t?.trim() && t.trim() !== session.title) void runtime.renameSession(session.id, t.trim())
              }}
            />
          </div>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-8 min-w-0 items-center gap-1 rounded-md px-2 font-serif text-[15.5px] text-fg transition-fast hover:bg-bg-muted data-[state=open]:bg-bg-muted"
              >
                {meta.starred ? <Star className="size-3.5 shrink-0 fill-current text-fg-muted" /> : null}
                <span className="truncate">{title}</span>
                <ChevronDown className="size-3.5 shrink-0 text-fg-muted" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => runtime.starSession(session.id, !meta.starred)}>
                {meta.starred ? <StarOff /> : <Star />}
                {meta.starred ? "Unstar" : "Star"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTimeout(() => setRenaming(true), 0)}>
                <Pencil />
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        <FilesDrawer sessionID={session.id} />
        {hasArtifacts ? (
          <Tip label={artifactOpen ? "Hide artifact" : "Show artifact"} shortcut={`${MOD}⇧A`}>
            <button
              type="button"
              aria-label={artifactOpen ? "Hide artifact" : "Show artifact"}
              aria-pressed={artifactOpen}
              onClick={onToggleArtifact}
              className={cn(
                "flex size-8 items-center justify-center rounded-md text-fg-secondary transition-fast hover:bg-bg-muted hover:text-fg",
                artifactOpen && "bg-bg-muted text-fg",
              )}
            >
              <PanelRight className="size-4" />
            </button>
          </Tip>
        ) : null}
      </div>
      <DeleteChatDialog
        session={confirmDelete ? session : undefined}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          void runtime.deleteSession(session.id)
          go(project ? { kind: "project", projectID: project.id } : { kind: "home" })
        }}
      />
    </header>
  )
}
