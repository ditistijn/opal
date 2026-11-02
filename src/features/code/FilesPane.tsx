import { ArrowLeft, ChevronRight, File, Folder, FolderOpen, Loader2, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { highlightCode } from "@/components/markdown/shiki"
import { Tip } from "@/components/ui/tooltip"
import { codeRuntime, type CodeFileEntry } from "@/lib/runtime/code"
import { cn } from "@/lib/utils"
import { useCodeNav } from "./code-nav"
import { langForPath, shikiLines } from "./diff-parse"

const HIDDEN = new Set([".git", ".DS_Store"])
const MAX_VIEW = 512 * 1024

function name(path: string) {
  return path.replace(/\/+$/, "").split("/").pop() ?? path
}

function DirNode({
  directory,
  entry,
  depth,
  onOpenFile,
  selected,
  version,
}: {
  directory: string
  entry: CodeFileEntry
  depth: number
  onOpenFile(path: string): void
  selected?: string
  version: number
}) {
  const [open, setOpen] = useState(false)
  const pad = { paddingLeft: 8 + depth * 14 }
  if (entry.type === "file")
    return (
      <li role="treeitem" aria-selected={selected === entry.path}>
        <button
          type="button"
          onClick={() => onOpenFile(entry.path)}
          style={pad}
          className={cn(
            "flex h-7 w-full min-w-0 items-center gap-1.5 pr-2 text-left text-[12.5px] transition-colors duration-[120ms]",
            selected === entry.path
              ? "bg-bg-inset/70 text-fg"
              : "text-fg-secondary hover:bg-bg-muted hover:text-fg",
          )}
        >
          <span className="size-3.5 shrink-0" />
          <File className="size-3.5 shrink-0 text-fg-muted" />
          <span className="truncate">{name(entry.path)}</span>
        </button>
      </li>
    )
  return (
    <li role="treeitem" aria-expanded={open}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={pad}
        className="flex h-7 w-full min-w-0 items-center gap-1.5 pr-2 text-left text-[12.5px] text-fg-secondary transition-colors duration-[120ms] hover:bg-bg-muted hover:text-fg"
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-fg-muted transition-transform duration-[120ms]",
            open && "rotate-90",
          )}
        />
        {open ? (
          <FolderOpen className="size-3.5 shrink-0 text-fg-muted" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-fg-muted" />
        )}
        <span className="truncate">{name(entry.path)}</span>
      </button>
      {open ? (
        <DirList
          directory={directory}
          path={entry.path}
          depth={depth + 1}
          onOpenFile={onOpenFile}
          selected={selected}
          version={version}
        />
      ) : null}
    </li>
  )
}

function DirList({
  directory,
  path,
  depth,
  onOpenFile,
  selected,
  version,
}: {
  directory: string
  path?: string
  depth: number
  onOpenFile(path: string): void
  selected?: string
  version: number
}) {
  const [entries, setEntries] = useState<CodeFileEntry[]>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let live = true
    codeRuntime
      .listFiles(directory, path)
      .then((list) => {
        if (!live) return
        setEntries(
          list
            .filter((e) => !HIDDEN.has(name(e.path)))
            .sort((a, b) =>
              a.type === b.type ? a.path.localeCompare(b.path) : a.type === "directory" ? -1 : 1,
            ),
        )
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [directory, path, version])
  if (error) return <div className="px-3 py-1 text-[12px] text-danger">{error}</div>
  if (!entries)
    return (
      <div
        className="flex h-7 items-center gap-1.5 text-[12px] text-fg-muted"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <Loader2 className="size-3 animate-spin" />
        Loading…
      </div>
    )
  return (
    <ul role={depth === 0 ? "tree" : "group"} aria-label={depth === 0 ? "Files" : undefined}>
      {entries.length === 0 ? (
        <li className="h-7 text-[12px] text-fg-faint" style={{ paddingLeft: 8 + depth * 14 + 20 }}>
          Empty
        </li>
      ) : (
        entries.map((e) => (
          <DirNode
            key={e.path}
            directory={directory}
            entry={e}
            depth={depth}
            onOpenFile={onOpenFile}
            selected={selected}
            version={version}
          />
        ))
      )}
    </ul>
  )
}

/** Read-only file viewer with line numbers and Shiki colouring. */
export function FileViewer({ directory, path }: { directory: string; path: string }) {
  const [content, setContent] = useState<string>()
  const [html, setHtml] = useState<string[]>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let live = true
    setContent(undefined)
    setHtml(undefined)
    setError(undefined)
    codeRuntime
      .readFile(directory, path)
      .then(async (text) => {
        if (!live) return
        const clipped = text.length > MAX_VIEW ? text.slice(0, MAX_VIEW) : text
        setContent(clipped)
        const lang = langForPath(path)
        if (!lang || clipped.length > 200_000) return
        const out = await highlightCode(clipped.replace(/\n$/, ""), lang).catch(() => null)
        if (live && out) setHtml(shikiLines(out))
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [directory, path])
  if (error) return <div className="p-3 text-[12.5px] text-danger">{error}</div>
  if (content === undefined)
    return (
      <div className="flex items-center gap-1.5 p-3 text-[12.5px] text-fg-muted">
        <Loader2 className="size-3.5 animate-spin" />
        Loading…
      </div>
    )
  if (content.includes("\u0000"))
    return <div className="p-3 text-[12.5px] text-fg-muted">Binary file — not shown.</div>
  const lines = content.replace(/\n$/, "").split("\n")
  return (
    <div className="opal-code selectable min-h-0 flex-1 overflow-auto" data-testid="file-viewer">
      <table className="border-collapse font-mono text-[12px] leading-[18px]">
        <tbody className="shiki">
          {lines.map((line, i) => (
            <tr key={i}>
              <td className="opal-diff-no sticky left-0 bg-bg">{i + 1}</td>
              <td className="whitespace-pre pr-4 text-fg">
                {html?.[i] !== undefined ? (
                  <span dangerouslySetInnerHTML={{ __html: html[i] }} />
                ) : (
                  line || " "
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {content.length >= MAX_VIEW ? (
        <div className="px-3 py-2 text-[11.5px] text-fg-muted">Showing the first 512 KB.</div>
      ) : null}
    </div>
  )
}

/** Files tab: a lazily-expanded tree of the session directory (`file.list`) with a read-only viewer. */
export function FilesPane({ directory }: { directory: string }) {
  const openFile = useCodeNav((s) => s.openFile)
  // Remount per directory (key) resets the selection; "Open file" from the diff pane selects a file.
  const [selected, setSelected] = useState<string | undefined>(() =>
    openFile?.directory === directory ? openFile.path : undefined,
  )
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (openFile && openFile.directory === directory) setSelected(openFile.path)
  }, [openFile, directory])

  const back = useCallback(() => setSelected(undefined), [])

  if (selected)
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="files-pane">
        <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-1.5">
          <button
            type="button"
            onClick={back}
            aria-label="Back to files"
            className="flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-muted hover:text-fg"
          >
            <ArrowLeft className="size-4" />
          </button>
          <span className="min-w-0 truncate font-mono text-[12px] text-fg" title={selected}>
            {selected}
          </span>
          <span className="ml-auto shrink-0 text-[11px] text-fg-faint">Read-only</span>
        </div>
        <FileViewer directory={directory} path={selected} />
      </div>
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="files-pane">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border pl-3 pr-1.5">
        <span className="min-w-0 truncate font-mono text-[11.5px] text-fg-muted" title={directory}>
          {directory}
        </span>
        <Tip label="Refresh">
          <button
            type="button"
            aria-label="Refresh files"
            onClick={() => setVersion((v) => v + 1)}
            className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-bg-muted hover:text-fg"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </Tip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <DirList directory={directory} depth={0} onOpenFile={setSelected} version={version} />
      </div>
    </div>
  )
}
