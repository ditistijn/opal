import type { ArtifactInfo } from "@/lib/opencode/types"
import type { ArtifactKind } from "@/lib/runtime/contracts"
import { isTauri } from "@/lib/utils"
import { shellFor } from "./kind"
import { encodeArtifactPath, isValidArtifactID, normalizeArtifactPath } from "./paths"

/** Origin of the custom protocol (macOS/Linux form; Windows would be http://artifact.localhost). */
export const ARTIFACT_ORIGIN = "artifact://localhost"
/** Renderer shells served by the protocol from the bundled public/artifact-runtime. */
export const PROTOCOL_RUNTIME_BASE = `${ARTIFACT_ORIGIN}/_runtime/`
/** Same shells served by Vite / the app's own origin (plain-browser dev, exports). */
export const APP_RUNTIME_BASE = "/artifact-runtime/"

/**
 * protocol: files are read by the iframe from artifact://localhost/<id>/… (Tauri).
 * bridge:   no protocol (plain browser) — the shell asks the parent for the files via postMessage.
 */
export type PreviewTransport = "protocol" | "bridge"

export interface PreviewOptions {
  transport?: PreviewTransport
  theme?: "light" | "dark"
  /** Preview an immutable version snapshot instead of the live files (protocol only). */
  version?: number
  /** Cache-buster; usually info.time.updated. */
  nonce?: string | number
}

export function defaultTransport(): PreviewTransport {
  return isTauri() ? "protocol" : "bridge"
}

/**
 * Builds the iframe URL for an artifact:
 *   html (protocol) → artifact://localhost/<id>[@n]/<entry>
 *   other kinds     → <runtime>/<shell>.html?id=<id>[@n]&entry=<entry>&theme=…
 *   bridge          → /artifact-runtime/<shell|html>.html?bridge=1&id=…&entry=…
 */
export function previewURL(
  info: Pick<ArtifactInfo, "id" | "entry">,
  kind: ArtifactKind,
  options: PreviewOptions = {},
): string {
  if (!isValidArtifactID(info.id)) throw new Error(`invalid artifact id: ${info.id}`)
  const entry = normalizeArtifactPath(info.entry)
  if (!entry) throw new Error(`invalid artifact entry: ${info.entry}`)
  const transport = options.transport ?? defaultTransport()
  const id =
    options.version !== undefined && transport === "protocol" ? `${info.id}@${options.version}` : info.id
  const shell = shellFor(kind)
  const query = new URLSearchParams()
  if (transport === "protocol" && !shell) {
    if (options.nonce !== undefined) query.set("v", String(options.nonce))
    const q = query.toString()
    return `${ARTIFACT_ORIGIN}/${id}/${encodeArtifactPath(entry)}${q ? `?${q}` : ""}`
  }
  if (transport === "bridge") query.set("bridge", "1")
  query.set("id", id)
  query.set("entry", entry)
  query.set("theme", options.theme ?? "light")
  if (options.nonce !== undefined) query.set("v", String(options.nonce))
  const base = transport === "protocol" ? PROTOCOL_RUNTIME_BASE : APP_RUNTIME_BASE
  // bridge mode has no protocol to serve raw files, so html and unknown kinds use the html/code shells
  const page = shell ?? (kind === "html" ? "html.html" : "code.html")
  return `${base}${page}?${query.toString()}`
}

/** iframe sandbox tokens. Bridge mode drops allow-same-origin: the shell would otherwise share the app origin. */
export function sandboxFor(transport: PreviewTransport): string {
  const base = "allow-scripts allow-forms allow-modals allow-popups allow-downloads"
  return transport === "protocol" ? `${base} allow-same-origin` : base
}

/** Responsive preview widths (px); undefined = fill the panel. */
export const PREVIEW_SIZES = [
  { id: "desktop", label: "Desktop", width: undefined },
  { id: "tablet", label: "Tablet", width: 768 },
  { id: "mobile", label: "Mobile", width: 390 },
] as const
export type PreviewSizeID = (typeof PREVIEW_SIZES)[number]["id"]

/** Only these schemes may be opened from an artifact (opal:open-url). */
export function isOpenableURL(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:"
  } catch {
    return false
  }
}

/**
 * Inline widgets (docs/INLINE-WIDGETS.md §2) always use the bridge shell, also inside the app:
 *   app     artifact://localhost/_runtime/widget.html?bridge=1&theme=<light|dark>
 *   browser /artifact-runtime/widget.html?bridge=1&theme=<light|dark>
 */
export function widgetShellURL(theme: "light" | "dark", inApp = isTauri()): string {
  const base = inApp ? PROTOCOL_RUNTIME_BASE : APP_RUNTIME_BASE
  return `${base}widget.html?bridge=1&theme=${theme}`
}

/**
 * Sandbox for inline widgets: opaque origin (never allow-same-origin), no popups, modals, downloads
 * or top navigation — stricter than `sandboxFor("bridge")` because widgets render inside the chat.
 */
export const WIDGET_SANDBOX = "allow-scripts allow-forms allow-pointer-lock"
