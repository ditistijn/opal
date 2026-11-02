import { useMemo, useRef, useState } from "react"
import { ChevronDown, LoaderCircle, RotateCw, Sparkles, TriangleAlert, X } from "lucide-react"
import type { ArtifactInfo } from "@/lib/opencode/types"
import type { ArtifactKind } from "@/lib/runtime/contracts"
import {
  defaultTransport,
  followsTheme,
  loadRuntimeUIFiles,
  openExternalURL,
  PREVIEW_SIZES,
  previewURL,
  sandboxFor,
  useArtifactErrors,
  usesRuntimeUI,
  type PreviewSizeID,
} from "@/lib/artifacts"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ArtifactRuntime } from "./types"

export interface ArtifactPreviewProps {
  rt: Pick<ArtifactRuntime, "getArtifactContent" | "sendPrompt">
  sessionID: string
  info: ArtifactInfo
  kind: ArtifactKind
  /** Snapshot to show instead of the live files. */
  version?: number
  /** Incremented by the Refresh action. */
  reloadCount: number
  size: PreviewSizeID
  theme: "light" | "dark"
  onReload(): void
}

/** The sandboxed iframe with loading shimmer, slow-load hint and error banner. */
export function ArtifactPreview({
  rt,
  sessionID,
  info,
  kind,
  version,
  reloadCount,
  size,
  theme,
  onReload,
}: ArtifactPreviewProps) {
  const transport = defaultTransport()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const shellTheme = followsTheme(kind) ? theme : "light"
  const src = useMemo(() => {
    try {
      return previewURL(info, kind, { transport, theme: shellTheme, version, nonce: info.time.updated })
    } catch {
      return undefined
    }
  }, [info, kind, transport, shellTheme, version])
  const loadKey = `${src}#${reloadCount}`
  const { status, markLoaded, dismissError } = useArtifactErrors(iframeRef, {
    loadKey,
    provideFiles:
      transport === "bridge"
        ? async () => {
            const c = await rt.getArtifactContent(info.id)
            // the opaque-origin shell cannot fetch the shadcn shims from the app origin itself
            const runtimeFiles =
              kind === "react" && usesRuntimeUI(c.files) ? await loadRuntimeUIFiles() : undefined
            return { id: info.id, entry: c.info.entry, files: c.files, runtimeFiles }
          }
        : undefined,
    onOpenURL: (url) => void openExternalURL(url),
  })
  const width = PREVIEW_SIZES.find((s) => s.id === size)?.width
  // "slow": show whatever the page has drawn so far (it may simply not send a render signal)
  const loading = status.state === "loading"
  // web pages assume a white canvas; document viewers follow the app theme
  const canvas = followsTheme(kind) ? "bg-bg-artifact" : "bg-white"

  return (
    <div
      data-artifact-id={info.id}
      data-preview-status={status.state}
      className={cn(
        "relative flex min-h-0 flex-1 justify-center overflow-hidden",
        width ? "bg-bg-muted" : canvas,
      )}
    >
      <div
        className={cn("relative h-full", width ? "border-x border-border shadow-elevated" : "w-full", canvas)}
        style={width ? { width, maxWidth: "100%" } : undefined}
      >
        {src ? (
          <iframe
            key={loadKey}
            ref={iframeRef}
            src={src}
            title={info.title}
            data-testid="artifact-iframe"
            sandbox={sandboxFor(transport)}
            referrerPolicy="no-referrer"
            allow="clipboard-write; fullscreen"
            onLoad={() => {
              // plain pages (and direct files) have no render signal of their own
              if (transport === "protocol" && (kind === "html" || kind === "unknown")) markLoaded()
            }}
            className={cn(
              "block h-full w-full border-0 transition-opacity duration-150",
              loading ? "opacity-0" : "opacity-100",
            )}
          />
        ) : (
          <div className="p-6 text-sm text-danger">This artifact has an invalid id or entry path.</div>
        )}
        {loading ? <Shimmer /> : null}
      </div>

      {status.state === "slow" ? (
        <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-bg-elevated py-1 pl-3 pr-1 text-xs text-fg-secondary shadow-elevated">
          <LoaderCircle className="size-3.5 animate-spin" />
          Taking longer than usual…
          <Button size="xs" variant="subtle" onClick={onReload}>
            <RotateCw /> Reload
          </Button>
        </div>
      ) : null}

      {status.state === "error" ? (
        <ErrorBanner
          message={status.error.message}
          stack={status.error.stack}
          phase={status.error.phase}
          onDismiss={dismissError}
          onFix={() =>
            void rt.sendPrompt(sessionID, {
              text: `The artifact failed to render: ${status.error.message}. Please fix it.`,
            })
          }
        />
      ) : null}
    </div>
  )
}

function Shimmer() {
  return (
    <div
      className="pointer-events-none absolute inset-0 flex flex-col gap-3 p-6"
      aria-label="Rendering…"
      role="status"
    >
      <div className="artifact-shimmer h-6 w-2/5 rounded-md" />
      <div className="artifact-shimmer h-3.5 w-4/5 rounded" />
      <div className="artifact-shimmer h-3.5 w-3/5 rounded" />
      <div className="artifact-shimmer mt-3 h-40 w-full rounded-lg" />
      <div className="artifact-shimmer h-3.5 w-2/3 rounded" />
      <span className="sr-only">Rendering…</span>
    </div>
  )
}

function ErrorBanner({
  message,
  stack,
  phase,
  onFix,
  onDismiss,
}: {
  message: string
  stack?: string
  phase?: string
  onFix(): void
  onDismiss(): void
}) {
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)
  return (
    <div
      role="alert"
      data-testid="artifact-error"
      className="absolute inset-x-3 bottom-3 rounded-lg border border-border bg-bg-elevated p-3 shadow-elevated"
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-fg">
            {phase === "transpile" ? "The artifact could not be compiled" : "The artifact failed to render"}
          </div>
          <pre
            className={cn(
              "selectable mt-1 whitespace-pre-wrap break-words font-mono text-xs text-fg-secondary",
              open ? "max-h-56 overflow-auto" : "line-clamp-2",
            )}
          >
            {message}
            {open && stack && stack !== message ? `\n\n${stack}` : ""}
          </pre>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="rounded-sm p-0.5 text-fg-muted transition-fast hover:bg-bg-muted hover:text-fg"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-2.5 flex items-center justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
          {open ? "Less" : "Details"}
          <ChevronDown className={cn("transition-transform duration-150", open && "rotate-180")} />
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={sent}
          onClick={() => {
            setSent(true)
            onFix()
          }}
        >
          <Sparkles /> {sent ? "Asked Opal" : "Ask Opal to fix"}
        </Button>
      </div>
    </div>
  )
}
