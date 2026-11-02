import "./artifacts.css"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AppWindow, History, LoaderCircle } from "lucide-react"
import type { ArtifactInfo } from "@/lib/opencode/types"
import {
  buildFilesZip,
  buildStandaloneHTML,
  copyText,
  detectKind,
  exportBaseName,
  followsTheme,
  kindLabel,
  openInBrowser,
  saveBytes,
  type PreviewSizeID,
} from "@/lib/artifacts"
import { Button } from "@/components/ui/button"
import { cn, formatRelativeTime } from "@/lib/utils"
import { ArtifactCode, orderedFiles } from "./ArtifactCode"
import { ArtifactHeader, type PanelMode } from "./ArtifactHeader"
import { ArtifactPreview } from "./ArtifactPreview"
import { useArtifactContent, useDocumentTheme, useFlash } from "./hooks"
import type { ArtifactRuntime } from "./types"

/** The artifact panel, parameterized by the runtime slice it uses (see ArtifactPanel.tsx). */
export function ArtifactPanelView({ sessionID, rt }: { sessionID: string; rt: ArtifactRuntime }) {
  const artifacts = rt.useArtifacts(sessionID)
  const { artifactID, setActive } = rt.useActiveArtifact(sessionID)
  const view = rt.useArtifact(artifactID)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopImmediatePropagation()
      setFullscreen(false)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [fullscreen])

  const shell = (children: React.ReactNode) => (
    <div
      data-testid="artifact-panel"
      data-fullscreen={fullscreen || undefined}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col bg-bg",
        fullscreen && "fixed inset-0 z-40 pt-[var(--titlebar-height)] shadow-elevated",
      )}
    >
      {fullscreen ? (
        <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-[var(--titlebar-height)]" />
      ) : null}
      {children}
    </div>
  )

  if (!artifactID) return shell(<EmptyState artifacts={artifacts} onOpen={setActive} />)
  if (!view)
    return shell(
      <div className="flex flex-1 items-center justify-center text-fg-muted">
        <LoaderCircle className="size-5 animate-spin" aria-label="Loading artifact" />
      </div>,
    )
  return shell(
    <ActiveArtifact
      key={view.info.id}
      rt={rt}
      sessionID={sessionID}
      info={view.info}
      fallbackKind={view.kind}
      versions={view.versions}
      artifacts={artifacts}
      onSelectArtifact={(id) => setActive(id)}
      onClose={() => {
        setFullscreen(false)
        setActive(undefined)
      }}
      fullscreen={fullscreen}
      onFullscreen={() => setFullscreen((f) => !f)}
    />,
  )
}

interface ActiveProps {
  rt: ArtifactRuntime
  sessionID: string
  info: ArtifactInfo
  fallbackKind: ReturnType<typeof detectKind>
  versions: { n: number; time: number; path: string; title: string }[]
  artifacts: ArtifactInfo[]
  onSelectArtifact(id: string): void
  onClose(): void
  fullscreen: boolean
  onFullscreen(): void
}

function ActiveArtifact({ rt, sessionID, info, fallbackKind, versions, artifacts, ...p }: ActiveProps) {
  const [mode, setMode] = useState<PanelMode>("preview")
  const [size, setSize] = useState<PreviewSizeID>("desktop")
  const [reloadCount, setReloadCount] = useState(0)
  const [version, setVersion] = useState<number>()
  const [activeFile, setActiveFile] = useState(info.entry)
  const [copied, flashCopied] = useFlash()
  const [actionError, setActionError] = useState<string>()
  const [restoring, setRestoring] = useState(false)
  const theme = useDocumentTheme()
  const content = useArtifactContent(rt, info.id, info.time.updated, version)
  const files = content.status === "ready" ? content.content.files : undefined
  const kind = useMemo(
    () => (files ? detectKind(info.entry, files) : fallbackKind),
    [files, info.entry, fallbackKind],
  )

  // a new live version arrived: leave the snapshot view
  useEffect(() => setVersion(undefined), [info.time.updated])

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setActionError(undefined)
    try {
      await fn()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const ready = content.status === "ready" ? content.content : undefined
  const base = exportBaseName(info.title)
  const shellTheme = followsTheme(kind) ? theme : "light"
  const copyFile =
    mode === "code" && ready
      ? orderedFiles(ready).includes(activeFile)
        ? activeFile
        : info.entry
      : info.entry

  return (
    <>
      <ArtifactHeader
        info={info}
        kind={kind}
        artifacts={artifacts}
        onSelectArtifact={p.onSelectArtifact}
        mode={mode}
        onMode={setMode}
        versions={versions}
        version={version}
        onVersion={setVersion}
        size={size}
        onSize={setSize}
        onRefresh={() => setReloadCount((n) => n + 1)}
        copied={copied}
        onCopy={() =>
          void run(async () => {
            if (!ready) throw new Error("The artifact is still loading")
            await copyText(ready.files[copyFile] ?? "")
            flashCopied()
          })
        }
        fileCount={ready ? Object.keys(ready.files).length : 1}
        onDownloadHTML={() =>
          void run(async () => {
            if (!ready) throw new Error("The artifact is still loading")
            await saveBytes(
              `${base}.html`,
              await buildStandaloneHTML(ready, kind, { theme: shellTheme }),
              "text/html",
            )
          })
        }
        onDownloadFiles={() =>
          void run(async () => {
            if (!ready) throw new Error("The artifact is still loading")
            const names = Object.keys(ready.files)
            if (names.length > 1) await saveBytes(`${base}.zip`, buildFilesZip(ready), "application/zip")
            else await saveBytes(names[0].split("/").pop() ?? names[0], ready.files[names[0]], "text/plain")
          })
        }
        onOpenInBrowser={() =>
          void run(async () => {
            if (!ready) throw new Error("The artifact is still loading")
            await openInBrowser(info.id, await buildStandaloneHTML(ready, kind, { theme: shellTheme }))
          })
        }
        fullscreen={p.fullscreen}
        onFullscreen={p.onFullscreen}
        onClose={p.onClose}
      />

      {version !== undefined ? (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-bg-muted px-3 text-xs text-fg-secondary">
          <History className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">
            Viewing version {version}
            {versions.find((v) => v.n === version)
              ? ` · ${formatRelativeTime(versions.find((v) => v.n === version)!.time)}`
              : ""}
          </span>
          <Button size="xs" variant="ghost" onClick={() => setVersion(undefined)}>
            Back to latest
          </Button>
          <Button
            size="xs"
            variant="primary"
            disabled={restoring}
            onClick={() =>
              void run(async () => {
                setRestoring(true)
                try {
                  await rt.restoreArtifactVersion(info.id, version)
                  setVersion(undefined)
                } finally {
                  setRestoring(false)
                }
              })
            }
          >
            {restoring ? "Restoring…" : "Restore this version"}
          </Button>
        </div>
      ) : null}

      {actionError ? (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 border-b border-border bg-danger-soft px-3 py-1.5 text-xs text-danger"
        >
          <span className="min-w-0 flex-1 truncate" title={actionError}>
            {actionError}
          </span>
          <button
            type="button"
            className="text-fg-secondary hover:text-fg"
            onClick={() => setActionError(undefined)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {mode === "preview" ? (
        <ArtifactPreview
          rt={rt}
          sessionID={sessionID}
          info={info}
          kind={kind}
          version={version}
          reloadCount={reloadCount}
          size={size}
          theme={theme}
          onReload={() => setReloadCount((n) => n + 1)}
        />
      ) : content.status === "ready" ? (
        <ArtifactCode
          rt={rt}
          content={content.content}
          activeFile={activeFile}
          onActiveFile={setActiveFile}
          readOnly={version !== undefined}
        />
      ) : content.status === "error" ? (
        <div className="p-6 text-sm text-danger">Could not load the artifact source: {content.error}</div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-fg-muted">
          <LoaderCircle className="size-5 animate-spin" aria-label="Loading source" />
        </div>
      )}
    </>
  )
}

function EmptyState({ artifacts, onOpen }: { artifacts: ArtifactInfo[]; onOpen(id: string): void }) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
      data-testid="artifact-empty"
    >
      <div className="flex size-10 items-center justify-center rounded-lg bg-bg-muted text-fg-muted">
        <AppWindow className="size-5" />
      </div>
      <div>
        <div className="text-sm font-medium text-fg">
          {artifacts.length ? "No artifact open" : "No artifacts yet"}
        </div>
        <div className="mt-1 max-w-72 text-[13px] text-fg-muted">
          {artifacts.length
            ? "Pick one of this chat's artifacts to preview it."
            : "Ask Opal to build something — a page, an app, a chart or a document — and it will appear here."}
        </div>
      </div>
      {artifacts.length ? (
        <div className="flex w-full max-w-80 flex-col gap-1">
          {[...artifacts]
            .sort((a, b) => b.time.updated - a.time.updated)
            .map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onOpen(a.id)}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-left transition-fast hover:bg-bg-muted"
              >
                <AppWindow className="size-4 shrink-0 text-fg-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-fg">{a.title || "Untitled artifact"}</div>
                  <div className="text-[11.5px] text-fg-muted">
                    {kindLabel(detectKind(a.entry), a.entry)} · {formatRelativeTime(a.time.updated)}
                  </div>
                </div>
              </button>
            ))}
        </div>
      ) : null}
    </div>
  )
}
