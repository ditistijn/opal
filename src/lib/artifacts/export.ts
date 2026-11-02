import type { ArtifactContent } from "@/lib/opencode/types"
import type { ArtifactKind } from "@/lib/runtime/contracts"
import { shellFor } from "./kind"
import { normalizeArtifactPath } from "./paths"
import { createZip } from "./zip"

/** shadcn-compatible shims shipped in public/artifact-runtime/shadcn (keep in sync with RUNTIME_FILES in Rust). */
export const RUNTIME_UI_FILES = [
  "shadcn/utils.js",
  "shadcn/alert.jsx",
  "shadcn/badge.jsx",
  "shadcn/button.jsx",
  "shadcn/card.jsx",
  "shadcn/checkbox.jsx",
  "shadcn/input.jsx",
  "shadcn/label.jsx",
  "shadcn/progress.jsx",
  "shadcn/select.jsx",
  "shadcn/separator.jsx",
  "shadcn/slider.jsx",
  "shadcn/switch.jsx",
  "shadcn/table.jsx",
  "shadcn/tabs.jsx",
  "shadcn/textarea.jsx",
] as const

/** Loads a file of public/artifact-runtime (relative path) as text. */
export type RuntimeLoader = (rel: string) => Promise<string>

/** Default loader: the runtime is part of the app's own static assets (Vite public dir / dist). */
export const fetchRuntimeFile: RuntimeLoader = async (rel) => {
  const res = await fetch(`/artifact-runtime/${rel}`)
  if (!res.ok) throw new Error(`runtime file not found: ${rel}`)
  return res.text()
}

/** A file name stem from a title: "Sales dashboard!" → "Sales dashboard". */
export function exportBaseName(title: string): string {
  const cleaned = title
    .replace(/[^\p{L}\p{N} ._()-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
  return (cleaned || "artifact").slice(0, 80)
}

const escapeScript = (s: string) => s.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--")

/** JSON safe to embed in an inline <script>. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ""
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

const MIME: Record<string, string> = {
  svg: "image/svg+xml",
  css: "text/css",
  js: "text/javascript",
  json: "application/json",
  txt: "text/plain",
  html: "text/html",
}

function resolveRef(entry: string, ref: string, files: Record<string, string>): string | undefined {
  if (!ref || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return undefined
  const clean = ref.split(/[?#]/)[0]
  const dir = entry.includes("/") ? entry.slice(0, entry.lastIndexOf("/") + 1) : ""
  const joined = clean.startsWith("/") ? clean : dir + clean
  // resolve ".." manually (normalizeArtifactPath rejects it)
  const parts: string[] = []
  for (const seg of joined.split("/")) {
    if (seg === "..") {
      if (!parts.length) return undefined
      parts.pop()
    } else if (seg && seg !== ".") parts.push(seg)
  }
  const p = normalizeArtifactPath(parts.join("/"))
  return p !== undefined && Object.prototype.hasOwnProperty.call(files, p) ? p : undefined
}

/**
 * Turns a multi-file HTML artifact into one self-contained HTML document: local stylesheets and
 * classic scripts are inlined, other local references (images, fonts…) become data: URIs, and the
 * Opal error bridge (only meaningful inside the app) is dropped.
 */
export function inlineHTMLArtifact(
  content: Pick<ArtifactContent, "files"> & { info: { entry: string } },
): string {
  const { files } = content
  const entry = normalizeArtifactPath(content.info.entry) ?? content.info.entry
  let html = files[entry] ?? ""
  html = html.replace(/<script\b[^>]*\bsrc=(["'])\/_runtime\/[^"']*\1[^>]*>\s*<\/script>\s*/gi, "")
  html = html.replace(
    /<script\b([^>]*?)\s*\bsrc=(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi,
    (m, a: string, _q, src: string, b: string) => {
      const p = resolveRef(entry, src, files)
      return p ? `<script${a}${b}>${escapeScript(files[p])}</script>` : m
    },
  )
  html = html.replace(
    /<link\b([^>]*?)\bhref=(["'])([^"']+)\2([^>]*)>/gi,
    (m, a: string, _q, href: string, b: string) => {
      const p = resolveRef(entry, href, files)
      if (!p || !/stylesheet/i.test(a + b)) return m
      return `<style>${files[p].replace(/<\/style/gi, "<\\/style")}</style>`
    },
  )
  html = html.replace(/\b(src|href|poster)=(["'])([^"']+)\2/gi, (m, attr: string, q: string, ref: string) => {
    const p = resolveRef(entry, ref, files)
    if (!p) return m
    const ext = p.split(".").pop()?.toLowerCase() ?? ""
    return `${attr}=${q}data:${MIME[ext] ?? "text/plain"};base64,${toBase64(files[p])}${q}`
  })
  return html
}

/** Inlines `<link href="./x.css">` and `<script src="./x.js">` of a runtime shell. */
async function inlineShell(shellHTML: string, load: RuntimeLoader): Promise<string> {
  const scripts = [...shellHTML.matchAll(/<script\b[^>]*\bsrc="\.\/([^"]+)"[^>]*><\/script>/g)]
  const links = [...shellHTML.matchAll(/<link\b[^>]*\bhref="\.\/([^"]+)"[^>]*>/g)]
  const loaded = new Map<string, string>()
  await Promise.all([...scripts, ...links].map(async (m) => loaded.set(m[1], await load(m[1]))))
  let out = shellHTML
  for (const m of links) out = out.replace(m[0], () => `<style>${loaded.get(m[1])}</style>`)
  for (const m of scripts)
    out = out.replace(m[0], () => `<script>${escapeScript(loaded.get(m[1]) ?? "")}</script>`)
  return out
}

/** Whether a React artifact imports the bundled shadcn-compatible shims. */
export function usesRuntimeUI(files: Record<string, string>): boolean {
  return Object.values(files).some((s) => s.includes("@/components/ui/") || s.includes("@/lib/utils"))
}

/** Loads the shadcn shim sources (for embedded/bridge shells that cannot fetch them themselves). */
export async function loadRuntimeUIFiles(
  load: RuntimeLoader = fetchRuntimeFile,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  await Promise.all(RUNTIME_UI_FILES.map(async (f) => (out[f] = await load(f))))
  return out
}

/**
 * Builds a single self-contained .html file for any artifact kind. HTML artifacts are inlined; other
 * kinds embed the matching renderer shell with the files as `window.__OPAL_ARTIFACT__` (CDN
 * dependencies such as React from esm.sh still need a network connection when opened).
 */
export async function buildStandaloneHTML(
  content: ArtifactContent,
  kind: ArtifactKind,
  options: { theme?: "light" | "dark"; load?: RuntimeLoader } = {},
): Promise<string> {
  if (kind === "html") return inlineHTMLArtifact(content)
  const load = options.load ?? fetchRuntimeFile
  const shell = shellFor(kind) ?? "code.html"
  const html = await inlineShell(await load(shell), load)
  const runtimeFiles = kind === "react" && usesRuntimeUI(content.files) ? await loadRuntimeUIFiles(load) : {}
  const payload = {
    id: content.info.id,
    entry: content.info.entry,
    title: content.info.title,
    theme: options.theme ?? "light",
    files: content.files,
    runtimeFiles,
  }
  const boot = `<script>window.__OPAL_ARTIFACT__=${jsonForScript(payload)}</script>`
  const titled = html.replace(
    /<title>[^<]*<\/title>/,
    () => `<title>${escapeHTML(content.info.title)}</title>`,
  )
  return titled.replace(/<head>/i, () => `<head>\n${boot}`)
}

function escapeHTML(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c)
}

/** Zip of the artifact's files under a folder named after its title. */
export function buildFilesZip(
  content: Pick<ArtifactContent, "files"> & { info: { title: string } },
): Uint8Array {
  const root = exportBaseName(content.info.title)
  const entries = Object.entries(content.files)
    .map(([path, data]) => ({ path: normalizeArtifactPath(path), data }))
    .filter((e): e is { path: string; data: string } => !!e.path)
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((e) => ({ path: `${root}/${e.path}`, data: e.data }))
  return createZip(entries)
}
