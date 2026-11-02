/**
 * Parent side of the artifact iframe protocol (see public/artifact-runtime/runtime.js header).
 * Messages are only accepted from the iframe's own contentWindow; the iframe origin is either
 * artifact://localhost or opaque ("null"), so origin is not used for trust — `event.source` is.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react"

export interface ArtifactRenderError {
  message: string
  stack?: string
  phase?: "load" | "transpile" | "runtime" | string
}

export type PreviewStatus =
  | { state: "loading" }
  | { state: "slow" }
  | { state: "rendered" }
  | { state: "error"; error: ArtifactRenderError }

export type ArtifactMessage =
  | { type: "opal:ready" }
  | { type: "opal:rendered"; kind?: string }
  | { type: "opal:error"; message: string; stack?: string; phase?: string }
  | { type: "opal:open-url"; url: string }
  /** Inline widgets (docs/INLINE-WIDGETS.md): content height of the widget document, in CSS px. */
  | { type: "opal:resize"; height: number }
  /** Inline widgets: `window.opal.sendPrompt(text)` — send `text` as the user's next message. */
  | { type: "opal:prompt"; text: string }

/** Validates an untrusted message payload from the iframe. */
export function parseArtifactMessage(data: unknown): ArtifactMessage | undefined {
  if (!data || typeof data !== "object") return undefined
  const d = data as Record<string, unknown>
  switch (d.type) {
    case "opal:ready":
      return { type: "opal:ready" }
    case "opal:rendered":
      return { type: "opal:rendered", kind: typeof d.kind === "string" ? d.kind : undefined }
    case "opal:error":
      return {
        type: "opal:error",
        message: typeof d.message === "string" && d.message ? d.message.slice(0, 4000) : "Unknown error",
        stack: typeof d.stack === "string" ? d.stack.slice(0, 8000) : undefined,
        phase: typeof d.phase === "string" ? d.phase : undefined,
      }
    case "opal:open-url":
      return typeof d.url === "string" ? { type: "opal:open-url", url: d.url } : undefined
    case "opal:resize":
      return typeof d.height === "number" && Number.isFinite(d.height) && d.height >= 0
        ? { type: "opal:resize", height: Math.min(Math.ceil(d.height), 100_000) }
        : undefined
    case "opal:prompt": {
      const text = typeof d.text === "string" ? d.text.trim() : ""
      return text ? { type: "opal:prompt", text: text.slice(0, 8000) } : undefined
    }
    default:
      return undefined
  }
}

export interface UseArtifactErrorsOptions {
  /** Changes whenever the iframe is (re)loaded; resets the status. */
  loadKey: string
  /** Bridge mode: called when the shell asks for its files. Return the payload to post. */
  provideFiles?: () => Promise<{
    id: string
    entry: string
    files: Record<string, string>
    runtimeFiles?: Record<string, string>
  }>
  onOpenURL?: (url: string) => void
  /** opal:resize from an inline widget (unclamped content height). */
  onResize?: (height: number) => void
  /** opal:prompt from an inline widget. */
  onPrompt?: (text: string) => void
  /** No render signal after this long → status "slow" (default 10s). */
  timeoutMs?: number
}

/**
 * Tracks the render status of an artifact iframe: loading → rendered | error (| slow after a timeout).
 * `markLoaded()` is for plain HTML pages that do not use the error bridge: call it from iframe onLoad.
 */
export function useArtifactErrors(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  options: UseArtifactErrorsOptions,
) {
  const { loadKey, timeoutMs = 10_000 } = options
  const [status, setStatus] = useState<PreviewStatus>({ state: "loading" })
  const opts = useRef(options)
  opts.current = options

  useEffect(() => {
    setStatus({ state: "loading" })
    const timer = window.setTimeout(() => {
      setStatus((s) => (s.state === "loading" ? { state: "slow" } : s))
    }, timeoutMs)
    return () => window.clearTimeout(timer)
  }, [loadKey, timeoutMs])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const win = iframeRef.current?.contentWindow
      if (!win || event.source !== win) return
      const msg = parseArtifactMessage(event.data)
      if (!msg) return
      switch (msg.type) {
        case "opal:ready": {
          const provide = opts.current.provideFiles
          if (!provide) return
          provide()
            .then((payload) => win.postMessage({ type: "opal:files", ...payload }, "*"))
            .catch((err: unknown) =>
              setStatus({
                state: "error",
                error: { message: err instanceof Error ? err.message : String(err), phase: "load" },
              }),
            )
          return
        }
        case "opal:rendered":
          setStatus((s) => (s.state === "error" ? s : { state: "rendered" }))
          return
        case "opal:error":
          setStatus({ state: "error", error: { message: msg.message, stack: msg.stack, phase: msg.phase } })
          return
        case "opal:open-url":
          opts.current.onOpenURL?.(msg.url)
          return
        case "opal:resize":
          opts.current.onResize?.(msg.height)
          return
        case "opal:prompt":
          opts.current.onPrompt?.(msg.text)
          return
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [iframeRef])

  const markLoaded = useCallback(() => {
    setStatus((s) => (s.state === "loading" || s.state === "slow" ? { state: "rendered" } : s))
  }, [])
  const dismissError = useCallback(() => setStatus({ state: "rendered" }), [])

  return { status, markLoaded, dismissError }
}
