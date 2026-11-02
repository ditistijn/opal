/**
 * DOM probes for the artifact preview. ArtifactPreview.tsx marks its wrapper with
 * `data-artifact-id` + `data-preview-status` (loading | slow | rendered | error).
 */

export interface PreviewState {
  status: string
  src?: string
  error?: string
}

function previewElement(artifactID: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-artifact-id="${CSS.escape(artifactID)}"][data-preview-status]`,
  )
}

export function readPreview(artifactID: string): PreviewState | undefined {
  const el = previewElement(artifactID)
  if (!el) return undefined
  const iframe = el.querySelector<HTMLIFrameElement>('iframe[data-testid="artifact-iframe"]')
  const status = el.dataset.previewStatus ?? "unknown"
  const error =
    status === "error"
      ? (el.querySelector('[data-testid="artifact-error"] pre')?.textContent ?? "").slice(0, 2000)
      : undefined
  return {
    status,
    ...(iframe ? { src: iframe.getAttribute("src") ?? undefined } : {}),
    ...(error ? { error } : {}),
  }
}

export interface PreviewEvent {
  /** ms since the tracker started */
  t: number
  kind: "status" | "src" | "load"
  value: string
}

/** Records status transitions, src changes and iframe `load` events of one artifact's preview. */
export function trackPreview(artifactID: string) {
  const started = performance.now()
  const events: PreviewEvent[] = []
  const seenFrames = new WeakSet<HTMLIFrameElement>()
  let last: PreviewState | undefined
  const push = (kind: PreviewEvent["kind"], value: string) =>
    events.push({ t: Math.round(performance.now() - started), kind, value })
  const check = () => {
    const el = previewElement(artifactID)
    const iframe = el?.querySelector<HTMLIFrameElement>('iframe[data-testid="artifact-iframe"]')
    if (iframe && !seenFrames.has(iframe)) {
      seenFrames.add(iframe)
      iframe.addEventListener("load", () => push("load", iframe.getAttribute("src") ?? ""))
    }
    const now = readPreview(artifactID)
    if (now?.status !== last?.status) push("status", now?.status ?? "absent")
    if (now?.src !== last?.src) push("src", now?.src ?? "")
    last = now
  }
  const observer = new MutationObserver(check)
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-preview-status", "src"],
  })
  check()
  return {
    events,
    stop: () => observer.disconnect(),
  }
}

/** The narrow layout shows "Chat | Artifact" tabs instead of a split. */
export function isNarrowLayout(): boolean {
  return [...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent?.trim() === "Artifact")
}

/** `v=<nonce>` of a preview URL (the cache-buster that changes with `time.updated`). */
export function nonceOf(src: string | undefined): string | undefined {
  if (!src) return undefined
  const q = src.indexOf("?")
  return q < 0 ? undefined : (new URLSearchParams(src.slice(q + 1)).get("v") ?? undefined)
}
