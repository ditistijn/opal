import { Check, ChevronRight, Columns2, Copy, FileCode2, RefreshCw, Rows2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Tip } from "@/components/ui/tooltip"
import { useCopy } from "@/hooks/use-copy"
import type { FileDiff } from "@/lib/opencode/types"
import { runtime } from "@/lib/runtime"
import { codeRuntime } from "@/lib/runtime/code"
import { cn } from "@/lib/utils"
import { useCodeNav } from "./code-nav"
import { DiffView, type DiffMode } from "./DiffView"

export type DiffSource = "session" | "working"

const MODE_KEY = "opal.code.diffMode"

function loadMode(): DiffMode {
  try {
    return localStorage.getItem(MODE_KEY) === "split" ? "split" : "unified"
  } catch {
    return "unified"
  }
}

const STATUS: Record<FileDiff["status"], { letter: string; className: string; label: string }> = {
  added: { letter: "A", className: "text-success", label: "Added" },
  deleted: { letter: "D", className: "text-danger", label: "Deleted" },
  modified: { letter: "M", className: "text-warning", label: "Modified" },
}

export function totals(files: FileDiff[]) {
  return files.reduce(
    (t, f) => ({ additions: t.additions + f.additions, deletions: t.deletions + f.deletions }),
    {
      additions: 0,
      deletions: 0,
    },
  )
}

function splitPath(path: string) {
  const i = path.lastIndexOf("/")
  return i < 0 ? { dir: "", name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) }
}

export function Counts({
  additions,
  deletions,
  className,
}: {
  additions: number
  deletions: number
  className?: string
}) {
  return (
    <span className={cn("shrink-0 font-mono text-[11.5px] tabular-nums", className)}>
      <span className="text-success">+{additions}</span> <span className="text-danger">−{deletions}</span>
    </span>
  )
}

/** The file index at the top of the diff pane. */
export function DiffFileList({ files, onSelect }: { files: FileDiff[]; onSelect(file: string): void }) {
  return (
    <ul aria-label="Changed files" className="py-1">
      {files.map((f) => {
        const { dir, name } = splitPath(f.file)
        const st = STATUS[f.status]
        return (
          <li key={f.file}>
            <button
              type="button"
              onClick={() => onSelect(f.file)}
              className="flex h-7 w-full min-w-0 items-center gap-2 px-3 text-left text-[12.5px] transition-colors duration-[120ms] hover:bg-bg-muted"
              title={f.file}
            >
              <span
                className={cn("w-3 shrink-0 font-mono text-[11px] font-semibold", st.className)}
                aria-label={st.label}
              >
                {st.letter}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="text-fg">{name}</span>
                {dir ? <span className="ml-1.5 text-fg-muted">{dir.replace(/\/$/, "")}</span> : null}
              </span>
              <Counts additions={f.additions} deletions={f.deletions} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function FileSection({
  diff,
  mode,
  directory,
  sectionRef,
}: {
  diff: FileDiff
  mode: DiffMode
  directory: string
  sectionRef(el: HTMLElement | null): void
}) {
  const [open, setOpen] = useState(true)
  const { copied, copy } = useCopy()
  const showFile = useCodeNav((s) => s.showFile)
  const st = STATUS[diff.status]
  return (
    <section ref={sectionRef} className="border-b border-border" data-file={diff.file}>
      <div className="group/file sticky top-0 z-[1] flex h-9 items-center gap-1.5 border-b border-border bg-bg-elevated px-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-fg-muted transition-transform duration-[120ms]",
              open && "rotate-90",
            )}
          />
          <span className={cn("font-mono text-[11px] font-semibold", st.className)}>{st.letter}</span>
          <span className="min-w-0 truncate font-mono text-[12px] text-fg">{diff.file}</span>
        </button>
        <Counts additions={diff.additions} deletions={diff.deletions} className="mr-1" />
        <Tip label="Copy patch">
          <button
            type="button"
            aria-label={`Copy patch for ${diff.file}`}
            onClick={() => void copy(diff.patch)}
            className="flex size-6 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-muted hover:text-fg"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </button>
        </Tip>
        {diff.status !== "deleted" ? (
          <Tip label="Open file">
            <button
              type="button"
              aria-label={`Open ${diff.file}`}
              onClick={() => showFile(directory, diff.file)}
              className="flex size-6 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-muted hover:text-fg"
            >
              <FileCode2 className="size-3.5" />
            </button>
          </Tip>
        ) : null}
      </div>
      {open ? (
        <>
          <DiffView patch={diff.patch} path={diff.file} mode={mode} />
          {diff.more ? (
            <div className="px-3 py-1.5 text-[11.5px] text-fg-muted">Diff truncated by the server.</div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

/**
 * Diff tab: the session's changes (`session.diff`) or the directory's uncommitted working tree
 * (`vcs.diff` working, refreshed when the session goes idle), unified or split.
 */
export function DiffPane({ sessionID, directory }: { sessionID: string; directory: string }) {
  const sessionDiff = runtime.useSessionDiff(sessionID)
  const activity = runtime.useSessionActivity(sessionID)
  const busy = activity !== "idle"
  const [source, setSource] = useState<DiffSource>("session")
  const [mode, setModeState] = useState<DiffMode>(loadMode)
  const [working, setWorking] = useState<FileDiff[]>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const sections = useRef(new Map<string, HTMLElement>())
  const { copied, copy } = useCopy()

  const setMode = (m: DiffMode) => {
    setModeState(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {}
  }

  const loadWorking = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      setWorking(await codeRuntime.workingDiff(directory))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [directory])

  const refresh = async () => {
    if (source === "working") return loadWorking()
    setLoading(true)
    try {
      await codeRuntime.refreshSessionDiff(sessionID)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // Working-tree diffs are read when the agent isn't mid-edit: on open, on switch, and when it goes idle.
  // LIMITATION: no file watcher drives this; edits made in the terminal need Refresh (docs/LIMITATIONS.md).
  useEffect(() => {
    if (source === "working" && !busy) void loadWorking()
  }, [source, busy, loadWorking])

  const files = source === "session" ? sessionDiff : (working ?? [])
  const t = totals(files)

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="diff-pane">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <div
          className="flex items-center rounded-md bg-bg-inset/60 p-0.5"
          role="tablist"
          aria-label="Diff source"
        >
          {(["session", "working"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={source === s}
              onClick={() => setSource(s)}
              className={cn(
                "rounded-[5px] px-2 py-0.5 text-[12px] font-medium transition-fast",
                source === s ? "bg-bg-elevated text-fg shadow-sm" : "text-fg-muted hover:text-fg",
              )}
            >
              {s === "session" ? "Session" : "Working tree"}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Tip label={mode === "unified" ? "Split view" : "Unified view"}>
          <button
            type="button"
            aria-label={mode === "unified" ? "Split view" : "Unified view"}
            onClick={() => setMode(mode === "unified" ? "split" : "unified")}
            className="flex size-7 items-center justify-center rounded-md text-fg-secondary hover:bg-bg-muted hover:text-fg"
          >
            {mode === "unified" ? <Columns2 className="size-4" /> : <Rows2 className="size-4" />}
          </button>
        </Tip>
        <Tip label="Refresh">
          <button
            type="button"
            aria-label="Refresh diff"
            onClick={() => void refresh()}
            disabled={loading}
            className="flex size-7 items-center justify-center rounded-md text-fg-secondary hover:bg-bg-muted hover:text-fg disabled:opacity-50"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </button>
        </Tip>
        <Tip label="Copy patch">
          <button
            type="button"
            aria-label="Copy full patch"
            disabled={!files.length}
            onClick={() => void copy(files.map((f) => f.patch).join("\n"))}
            className="flex size-7 items-center justify-center rounded-md text-fg-secondary hover:bg-bg-muted hover:text-fg disabled:opacity-40"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </button>
        </Tip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div role="alert" className="m-3 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
            {error}
          </div>
        ) : null}
        {source === "working" && busy ? (
          <div className="border-b border-border px-3 py-1.5 text-[11.5px] text-fg-muted">
            The agent is working — the working tree refreshes when it's idle.
          </div>
        ) : null}
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <p className="text-[13px] text-fg-secondary">
              {source === "working"
                ? loading && !working
                  ? "Loading…"
                  : "No uncommitted changes."
                : "No changes in this session yet."}
            </p>
            {source === "session" ? (
              <button
                type="button"
                onClick={() => setSource("working")}
                className="text-[12.5px] text-fg-muted underline-offset-4 hover:text-fg hover:underline"
              >
                Show working tree changes
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex h-8 items-center gap-2 px-3 text-[12px] text-fg-secondary">
              <span>
                {files.length} file{files.length === 1 ? "" : "s"} changed
              </span>
              <Counts additions={t.additions} deletions={t.deletions} />
            </div>
            <div className="border-b border-border">
              <DiffFileList
                files={files}
                onSelect={(file) =>
                  sections.current.get(file)?.scrollIntoView({ block: "start", behavior: "smooth" })
                }
              />
            </div>
            {files.map((f) => (
              <FileSection
                key={f.file}
                diff={f}
                mode={mode}
                directory={directory}
                sectionRef={(el) => {
                  if (el) sections.current.set(f.file, el)
                  else sections.current.delete(f.file)
                }}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
