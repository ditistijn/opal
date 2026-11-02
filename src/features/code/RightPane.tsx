import { X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Tip } from "@/components/ui/tooltip"
import { MOD } from "@/features/sidebar/Sidebar"
import { runtime } from "@/lib/runtime"
import { cn } from "@/lib/utils"
import { PANE_MIN, useCodeNav, type PaneTab } from "./code-nav"
import { DiffPane } from "./DiffPane"
import { FilesPane } from "./FilesPane"
import { SubagentsPane } from "./SubagentsPane"
import { TerminalPane } from "./TerminalPane"

const TABS: { id: PaneTab; label: string; shortcut?: string }[] = [
  { id: "diff", label: "Diff", shortcut: `${MOD}⇧D` },
  { id: "terminal", label: "Terminal", shortcut: `${MOD}\`` },
  { id: "subagents", label: "Subagents" },
  { id: "files", label: "Files" },
]

function Badge({ n }: { n: number }) {
  if (!n) return null
  return (
    <span className="ml-1 rounded-full bg-bg-inset px-1.5 text-[10.5px] font-medium tabular-nums leading-4 text-fg-secondary">
      {n}
    </span>
  )
}

/** Resizable, collapsible right pane with tabs: Diff, Terminal, Subagents, Files. */
export function RightPane({ sessionID, directory }: { sessionID: string; directory: string }) {
  const tab = useCodeNav((s) => s.paneTab)
  const width = useCodeNav((s) => s.paneWidth)
  const subagentID = useCodeNav((s) => s.subagentID)
  const { setPane, setPaneWidth, showSubagent } = useCodeNav.getState()
  const diff = runtime.useSessionDiff(sessionID)
  const children = runtime.useChildSessions(sessionID)
  const [dragging, setDragging] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // Keep terminals mounted once visited, so switching tabs doesn't drop the screen.
  const [terminalVisited, setTerminalVisited] = useState(tab === "terminal")
  useEffect(() => {
    if (tab === "terminal") setTerminalVisited(true)
  }, [tab])
  useEffect(() => setTerminalVisited(useCodeNav.getState().paneTab === "terminal"), [sessionID])

  const onMove = useCallback(
    (e: PointerEvent) => {
      const parent = box.current?.parentElement
      if (!parent) return
      const rect = parent.getBoundingClientRect()
      const max = Math.max(PANE_MIN, rect.width * 0.7)
      setPaneWidth(Math.min(max, Math.max(PANE_MIN, rect.right - e.clientX)))
    },
    [setPaneWidth],
  )
  useEffect(() => {
    if (!dragging) return
    const up = () => setDragging(false)
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", up)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", up)
    }
  }, [dragging, onMove])

  return (
    <div
      ref={box}
      className="relative flex min-h-0 shrink-0 flex-col border-l border-border bg-bg"
      style={{ width: `min(${width}px, 70%)` }}
      aria-label="Session panel"
      role="complementary"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setPaneWidth(width + 24)
          if (e.key === "ArrowRight") setPaneWidth(width - 24)
        }}
        className="group/sep absolute inset-y-0 -left-[3px] z-20 w-[6px] cursor-col-resize"
      >
        <span className="absolute inset-y-0 left-[2px] w-[2px] transition-colors duration-[120ms] group-hover/sep:bg-accent/40 group-focus-visible/sep:bg-accent/50" />
      </div>

      <div
        className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border px-1.5"
        role="tablist"
        aria-label="Panel"
      >
        {TABS.map((t) => (
          <Tip key={t.id} label={t.label} shortcut={t.shortcut}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setPane(true, t.id)}
              className={cn(
                "flex h-7 items-center rounded-md px-2.5 text-[12.5px] font-medium transition-colors duration-[120ms]",
                tab === t.id ? "bg-bg-inset/70 text-fg" : "text-fg-muted hover:bg-bg-muted hover:text-fg",
              )}
            >
              {t.label}
              {t.id === "diff" ? (
                <Badge n={diff.length} />
              ) : t.id === "subagents" ? (
                <Badge n={children.length} />
              ) : null}
            </button>
          </Tip>
        ))}
        <div className="flex-1" />
        <Tip label="Close panel">
          <button
            type="button"
            aria-label="Close panel"
            onClick={() => setPane(false)}
            className="flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-muted hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </Tip>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {tab === "diff" ? <DiffPane key={sessionID} sessionID={sessionID} directory={directory} /> : null}
        {tab === "subagents" ? (
          <SubagentsPane sessionID={sessionID} openID={subagentID} onOpen={showSubagent} />
        ) : null}
        {tab === "files" ? <FilesPane key={directory} directory={directory} /> : null}
        {terminalVisited ? (
          <div className={tab === "terminal" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
            <TerminalPane sessionID={sessionID} directory={directory} />
          </div>
        ) : null}
      </div>
      {dragging ? <div className="fixed inset-0 z-50 cursor-col-resize" /> : null}
    </div>
  )
}
