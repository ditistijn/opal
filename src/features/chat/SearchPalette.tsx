import { MessageSquare, Search, SquarePen } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { sessionTitle } from "@/features/sidebar/group-sessions"
import { runtime } from "@/lib/runtime"
import { cn, formatRelativeTime } from "@/lib/utils"
import { useNav } from "./nav-store"

/** ⌘K command-palette search over chat conversations (title + message text). */
export function SearchPalette() {
  const open = useNav((s) => s.searchOpen)
  const setOpen = useNav((s) => s.setSearchOpen)
  const go = useNav((s) => s.go)
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState(0)
  const results = runtime.useSessions({ surface: "chat", search: query || undefined })
  const settings = runtime.useSettings()
  const list = useMemo(() => results.slice(0, query ? 50 : 8), [results, query])
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery("")
      setIndex(0)
    }
  }, [open])
  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView?.({ block: "nearest" })
  }, [index])

  // index 0 = "New chat" action, 1..n = sessions
  const total = list.length + 1
  const choose = (i: number) => {
    setOpen(false)
    if (i === 0) go({ kind: "home" })
    else go({ kind: "session", sessionID: list[i - 1].id })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        hideClose
        aria-describedby={undefined}
        className="top-[13%] w-[min(92vw,600px)] translate-y-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Search chats</DialogTitle>
        <div className="flex h-12 items-center gap-2.5 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-fg-muted" />
          <input
            autoFocus
            aria-label="Search chats"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setIndex((i) => (i + 1) % total)
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setIndex((i) => (i - 1 + total) % total)
              } else if (e.key === "Enter") {
                e.preventDefault()
                choose(index)
              }
            }}
            className="selectable h-full flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-muted focus-visible:outline-none"
          />
          <Kbd>esc</Kbd>
        </div>
        <div
          ref={listRef}
          className="max-h-[min(60vh,440px)] overflow-y-auto p-1.5"
          role="listbox"
          aria-label="Results"
        >
          <Row active={index === 0} index={0} onHover={setIndex} onChoose={choose}>
            <SquarePen className="size-4 text-fg-muted" />
            <span className="flex-1 text-[13.5px]">New chat</span>
          </Row>
          {list.length ? (
            <div className="px-2.5 pb-1 pt-2.5 text-[11.5px] font-medium text-fg-muted">
              {query ? "Chats" : "Recent chats"}
            </div>
          ) : null}
          {list.map((s, i) => {
            const projectID = runtime.getOpalMetadata(s).projectID
            const project = projectID ? settings.projects.find((p) => p.id === projectID) : undefined
            return (
              <Row key={s.id} active={index === i + 1} index={i + 1} onHover={setIndex} onChoose={choose}>
                <MessageSquare className="size-4 shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{sessionTitle(s)}</span>
                {project ? (
                  <span className="max-w-32 truncate text-[12px] text-fg-muted">{project.name}</span>
                ) : null}
                <span className="shrink-0 text-[12px] text-fg-faint">
                  {formatRelativeTime(s.time.updated)}
                </span>
              </Row>
            )
          })}
          {query && list.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-fg-muted">No chats match “{query}”</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Row({
  active,
  index,
  onHover,
  onChoose,
  children,
}: {
  active: boolean
  index: number
  onHover(i: number): void
  onChoose(i: number): void
  children: React.ReactNode
}) {
  return (
    <div
      role="option"
      aria-selected={active}
      data-index={index}
      onMouseMove={() => onHover(index)}
      onClick={() => onChoose(index)}
      className={cn(
        "flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-fg",
        active && "bg-bg-muted",
      )}
    >
      {children}
    </div>
  )
}
