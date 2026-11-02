import { AlertCircle, Loader2, Plus, SquareTerminal, X } from "lucide-react"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Tip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useTerminals } from "./terminal-store"
import { XtermView } from "./XtermView"

const EMPTY: never[] = []

/** Terminal tab: one or more xterm terminals attached to OpenCode PTYs in the session directory. */
export function TerminalPane({ sessionID, directory }: { sessionID: string; directory: string }) {
  const tabs = useTerminals((s) => s.tabs[sessionID] ?? EMPTY)
  const active = useTerminals((s) => s.active[sessionID])
  const { addTab, closeTab, setActive, restartTab, ensure } = useTerminals.getState()

  // First visit: re-attach PTYs still running in this directory, or open a fresh terminal.
  useEffect(() => {
    void ensure(sessionID, directory)
  }, [sessionID, directory, ensure])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg" data-testid="terminal-pane">
      <div
        className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-1.5"
        role="tablist"
        aria-label="Terminals"
      >
        {tabs.map((t) => (
          <div
            key={t.key}
            className={cn(
              "group/tt flex h-7 items-center rounded-md pl-2 pr-0.5 text-[12px] transition-colors duration-[120ms]",
              t.key === active ? "bg-bg-inset/70 text-fg" : "text-fg-muted hover:bg-bg-muted hover:text-fg",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={t.key === active}
              onClick={() => setActive(sessionID, t.key)}
              className="flex items-center gap-1.5"
            >
              <SquareTerminal className="size-3.5" />
              {t.title}
            </button>
            <button
              type="button"
              aria-label={`Close ${t.title}`}
              onClick={() => closeTab(sessionID, t.key)}
              className="ml-1 flex size-5 items-center justify-center rounded-sm opacity-60 hover:bg-bg-inset hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <Tip label="New terminal">
          <button
            type="button"
            aria-label="New terminal"
            onClick={() => void addTab(sessionID, directory)}
            className="flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-muted hover:text-fg"
          >
            <Plus className="size-3.5" />
          </button>
        </Tip>
      </div>
      {tabs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[13px] text-fg-muted">
          No terminals open.
          <Button size="sm" variant="outline" onClick={() => void addTab(sessionID, directory)}>
            <Plus />
            New terminal
          </Button>
        </div>
      ) : (
        tabs.map((t) =>
          t.error ? (
            t.key === active ? (
              <div
                key={t.key}
                className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
              >
                <AlertCircle className="size-5 text-danger" />
                <p className="text-[12.5px] text-fg-secondary">Couldn't start a terminal: {t.error}</p>
                <Button size="sm" variant="outline" onClick={() => void restartTab(sessionID, t.key)}>
                  Try again
                </Button>
              </div>
            ) : null
          ) : t.handle ? (
            <XtermView
              key={t.key}
              handle={t.handle}
              visible={t.key === active}
              onRestart={() => void restartTab(sessionID, t.key)}
            />
          ) : t.key === active ? (
            <div
              key={t.key}
              className="flex flex-1 items-center justify-center gap-2 text-[12.5px] text-fg-muted"
            >
              <Loader2 className="size-4 animate-spin" />
              Starting shell…
            </div>
          ) : null,
        )
      )}
    </div>
  )
}
