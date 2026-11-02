/**
 * Sandboxed iframe for ` ```widget ` (and generated Mermaid) documents. The document never lives in the
 * app origin: the iframe loads the widget shell over the artifact bridge, which asks for the document
 * with opal:ready (docs/INLINE-WIDGETS.md §2).
 */
import { ChevronDown, Sparkles, TriangleAlert, X } from "lucide-react"
import { memo, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { useDocumentTheme } from "@/features/artifacts/hooks"
import { openExternalURL, useArtifactErrors, WIDGET_SANDBOX, widgetShellURL } from "@/lib/artifacts"
import { cn } from "@/lib/utils"
import { askToFix, makeRateLimiter, sendWidgetPrompt } from "./actions"
import { contentHash } from "./fence"

export const MIN_FRAME_HEIGHT = 80
export const MAX_FRAME_HEIGHT = 640
const INITIAL_HEIGHT = 160

export function clampFrameHeight(h: number): number {
  return Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, Math.ceil(h)))
}

export interface WidgetFrameProps {
  /** Full HTML document to render. */
  html: string
  /** Accessible name of the iframe. */
  title: string
  /** Used in error text ("The inline widget failed…"). */
  what: "widget" | "diagram"
  sessionID?: string
  /** Height used until the document reports its own. */
  initialHeight?: number
}

/** Mounts once per document (content hash) and theme; identical props re-render as a no-op. */
export const WidgetFrame = memo(function WidgetFrame({
  html,
  title,
  what,
  sessionID,
  initialHeight = INITIAL_HEIGHT,
}: WidgetFrameProps) {
  const theme = useDocumentTheme()
  const hash = useMemo(() => contentHash(html), [html])
  const [reloads, setReloads] = useState(0)
  const loadKey = `${hash}:${theme}:${reloads}`
  const src = widgetShellURL(theme)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  // last reported height survives theme reloads, so the card does not collapse and regrow
  const [height, setHeight] = useState<number | undefined>(undefined)
  const allowPrompt = useMemo(() => makeRateLimiter(), [])
  const htmlRef = useRef(html)
  htmlRef.current = html

  const { status, dismissError } = useArtifactErrors(iframeRef, {
    loadKey,
    provideFiles: async () => ({
      id: `inline-${hash}`,
      entry: "index.html",
      files: { "index.html": htmlRef.current },
    }),
    onOpenURL: (url) => void openExternalURL(url),
    onResize: (h) => setHeight(clampFrameHeight(h)),
    onPrompt: (text) => {
      if (allowPrompt()) sendWidgetPrompt(sessionID, text)
    },
  })
  const visible = status.state !== "loading" || height !== undefined

  return (
    <div data-widget-status={status.state}>
      <div className="relative">
        <iframe
          key={loadKey}
          ref={iframeRef}
          src={src}
          title={title}
          data-testid="inline-widget-frame"
          sandbox={WIDGET_SANDBOX}
          referrerPolicy="no-referrer"
          className={cn(
            "opal-inline-frame block w-full border-0 bg-transparent",
            visible ? "opacity-100" : "opacity-0",
          )}
          style={{ height: height ?? initialHeight }}
        />
        {visible ? null : (
          <div className="pointer-events-none absolute inset-0 py-1" role="status" aria-label="Loading">
            <div className="opal-inline-skeleton h-full w-full rounded-lg opacity-60" />
          </div>
        )}
      </div>
      {status.state === "error" ? (
        <FrameError
          what={what}
          message={status.error.message}
          stack={status.error.stack}
          onDismiss={dismissError}
          onRetry={() => setReloads((n) => n + 1)}
          onFix={sessionID ? () => askToFix(sessionID, what, status.error.message) : undefined}
        />
      ) : null}
    </div>
  )
})

function FrameError({
  what,
  message,
  stack,
  onFix,
  onRetry,
  onDismiss,
}: {
  what: string
  message: string
  stack?: string
  onFix?: () => void
  onRetry(): void
  onDismiss(): void
}) {
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)
  return (
    <div
      role="alert"
      data-testid="inline-widget-error"
      className="my-2 rounded-lg border border-border bg-bg p-3"
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-fg">The {what} ran into an error</div>
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
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Reload
        </Button>
        {onFix ? (
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
        ) : null}
      </div>
    </div>
  )
}
