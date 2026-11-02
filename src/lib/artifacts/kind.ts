import type { ArtifactKind } from "@/lib/runtime/contracts"

/** Lowercased extension of a path ("" when none). */
export function extOf(path: string): string {
  const base = path.split("/").pop() ?? ""
  const i = base.lastIndexOf(".")
  return i > 0 ? base.slice(i + 1).toLowerCase() : ""
}

const BY_EXT: Record<string, ArtifactKind> = {
  html: "html",
  htm: "html",
  tsx: "react",
  jsx: "react",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  mmd: "mermaid",
  mermaid: "mermaid",
  svg: "svg",
  json: "json",
  csv: "csv",
  tsv: "csv",
}

/** Language names for "code" artifacts and Shiki language ids, keyed by extension. */
const LANGS: Record<string, { label: string; shiki: string }> = {
  js: { label: "JavaScript", shiki: "javascript" },
  mjs: { label: "JavaScript", shiki: "javascript" },
  cjs: { label: "JavaScript", shiki: "javascript" },
  ts: { label: "TypeScript", shiki: "typescript" },
  mts: { label: "TypeScript", shiki: "typescript" },
  tsx: { label: "TSX", shiki: "tsx" },
  jsx: { label: "JSX", shiki: "jsx" },
  html: { label: "HTML", shiki: "html" },
  htm: { label: "HTML", shiki: "html" },
  css: { label: "CSS", shiki: "css" },
  scss: { label: "SCSS", shiki: "scss" },
  md: { label: "Markdown", shiki: "markdown" },
  markdown: { label: "Markdown", shiki: "markdown" },
  mdx: { label: "MDX", shiki: "mdx" },
  mmd: { label: "Mermaid", shiki: "mermaid" },
  mermaid: { label: "Mermaid", shiki: "mermaid" },
  svg: { label: "SVG", shiki: "xml" },
  xml: { label: "XML", shiki: "xml" },
  json: { label: "JSON", shiki: "json" },
  csv: { label: "CSV", shiki: "csv" },
  tsv: { label: "TSV", shiki: "tsv" },
  py: { label: "Python", shiki: "python" },
  rs: { label: "Rust", shiki: "rust" },
  go: { label: "Go", shiki: "go" },
  rb: { label: "Ruby", shiki: "ruby" },
  java: { label: "Java", shiki: "java" },
  kt: { label: "Kotlin", shiki: "kotlin" },
  swift: { label: "Swift", shiki: "swift" },
  c: { label: "C", shiki: "c" },
  h: { label: "C", shiki: "c" },
  cpp: { label: "C++", shiki: "cpp" },
  hpp: { label: "C++", shiki: "cpp" },
  cs: { label: "C#", shiki: "csharp" },
  php: { label: "PHP", shiki: "php" },
  sh: { label: "Shell", shiki: "bash" },
  bash: { label: "Shell", shiki: "bash" },
  zsh: { label: "Shell", shiki: "bash" },
  sql: { label: "SQL", shiki: "sql" },
  yaml: { label: "YAML", shiki: "yaml" },
  yml: { label: "YAML", shiki: "yaml" },
  toml: { label: "TOML", shiki: "toml" },
  lua: { label: "Lua", shiki: "lua" },
  r: { label: "R", shiki: "r" },
  dart: { label: "Dart", shiki: "dart" },
  txt: { label: "Text", shiki: "text" },
}

const BINARY = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "ico",
  "pdf",
  "mp4",
  "webm",
  "mp3",
  "wav",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "zip",
  "wasm",
])

/** Heuristic: does a .js/.ts file contain JSX or import React? */
function looksLikeReact(source: string): boolean {
  return (
    /\bfrom\s+["']react(?:-dom)?(?:\/[a-z-]+)?["']/.test(source) ||
    /\breturn\s*\(?\s*<[A-Za-z>]/.test(source) ||
    /<\/[A-Za-z][\w.]*>|<[A-Z][\w.]*[\s/>]/.test(source)
  )
}

/** Decides how an artifact is rendered from its entry path (and, for .js/.ts, its content). */
export function detectKind(entry: string, files?: Record<string, string>): ArtifactKind {
  const ext = extOf(entry)
  const byExt = BY_EXT[ext]
  if (byExt) return byExt
  if (ext === "js" || ext === "ts" || ext === "mjs" || ext === "mts") {
    const source = files?.[entry]
    return source !== undefined && looksLikeReact(source) ? "react" : "code"
  }
  if (BINARY.has(ext)) return "unknown"
  if (LANGS[ext]) return "code"
  if (!ext && files?.[entry] !== undefined) return "code"
  return "unknown"
}

/** Short badge text: "HTML", "React", "Markdown", "Python" … */
export function kindLabel(kind: ArtifactKind, entry = ""): string {
  switch (kind) {
    case "html":
      return "HTML"
    case "react":
      return "React"
    case "markdown":
      return "Markdown"
    case "mermaid":
      return "Mermaid"
    case "svg":
      return "SVG"
    case "json":
      return "JSON"
    case "csv":
      return extOf(entry) === "tsv" ? "TSV" : "CSV"
    case "code":
      return LANGS[extOf(entry)]?.label ?? "Code"
    default:
      return "File"
  }
}

/** Shiki language id for a file path ("text" when unknown). */
export function shikiLanguage(path: string): string {
  return LANGS[extOf(path)]?.shiki ?? "text"
}

/** Runtime shell (public/artifact-runtime/<shell>.html) that renders a kind; undefined = load the entry directly. */
export function shellFor(kind: ArtifactKind): string | undefined {
  switch (kind) {
    case "react":
    case "markdown":
    case "mermaid":
    case "svg":
    case "json":
    case "csv":
    case "code":
      return `${kind}.html`
    default:
      return undefined
  }
}

/** Whether a kind's preview follows the app theme (documents/viewers) or stays light like a web page. */
export function followsTheme(kind: ArtifactKind): boolean {
  return kind !== "html" && kind !== "react" && kind !== "unknown"
}
