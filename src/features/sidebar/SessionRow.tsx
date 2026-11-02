import { Ellipsis, Pencil, Star, StarOff, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { SessionInfo } from "@/lib/opencode/types"
import { runtime } from "@/lib/runtime"
import { cn } from "@/lib/utils"
import { sessionTitle } from "./group-sessions"

/** One conversation in the sidebar: click to open, "…" for star / rename (inline) / delete. */
export function SessionRow({
  session,
  active,
  onOpen,
  onDelete,
}: {
  session: SessionInfo
  active: boolean
  onOpen(): void
  onDelete(): void
}) {
  const [renaming, setRenaming] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const starred = runtime.getOpalMetadata(session).starred === true
  const activity = runtime.useSessionActivity(session.id)
  const title = sessionTitle(session)

  if (renaming) {
    return (
      <RenameInput
        initial={session.title ?? ""}
        onDone={(t) => {
          setRenaming(false)
          if (t !== undefined && t.trim() && t.trim() !== session.title)
            void runtime.renameSession(session.id, t.trim())
        }}
      />
    )
  }

  return (
    <div
      className={cn(
        "group/row relative flex h-8 items-center rounded-md transition-colors duration-[120ms]",
        active ? "bg-bg-inset text-fg" : "text-fg-secondary hover:bg-bg-inset/60 hover:text-fg",
      )}
      data-active={active || undefined}
    >
      <button
        type="button"
        onClick={onOpen}
        onDoubleClick={() => setRenaming(true)}
        className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2.5 pr-8 text-left text-[13px]"
        title={title}
      >
        <span className="truncate">{title}</span>
        {activity === "busy" || activity === "queued" ? (
          <span
            aria-label={activity === "queued" ? "Queued" : "Generating"}
            className={cn(
              "ml-auto size-1.5 shrink-0 rounded-full",
              activity === "busy" ? "animate-pulse bg-accent" : "bg-fg-faint",
            )}
          />
        ) : null}
      </button>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`More options for ${title}`}
            className={cn(
              "absolute right-1 flex size-6 items-center justify-center rounded-sm text-fg-muted transition-opacity duration-[120ms] hover:bg-bg-inset hover:text-fg",
              menuOpen ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
            )}
          >
            <Ellipsis className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[160px]">
          <DropdownMenuItem onSelect={() => runtime.starSession(session.id, !starred)}>
            {starred ? <StarOff /> : <Star />}
            {starred ? "Unstar" : "Star"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTimeout(() => setRenaming(true), 0)}>
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={onDelete}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function RenameInput({ initial, onDone }: { initial: string; onDone(value?: string): void }) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const finish = (v?: string) => {
    if (done.current) return
    done.current = true
    onDone(v)
  }
  return (
    <input
      ref={ref}
      aria-label="Rename chat"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value)
        if (e.key === "Escape") {
          e.stopPropagation()
          finish(undefined)
        }
      }}
      className="selectable h-8 w-full rounded-md border border-accent/50 bg-bg-elevated px-2.5 text-[13px] text-fg outline-none ring-2 ring-ring/30"
    />
  )
}
