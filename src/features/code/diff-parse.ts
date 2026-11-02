/**
 * Unified-diff parsing for the diff pane. Handles both patch flavours OpenCode emits:
 * `createTwoFilesPatch` (Index:/====/---/+++) from session.diff and tool metadata, and git-style
 * (`diff --git`, `index`, `new file mode` …) from vcs.diff.
 */

export type DiffLineKind = "context" | "add" | "del"

export interface DiffLine {
  kind: DiffLineKind
  text: string
  /** 1-based line numbers in the old / new file (undefined on the side the line doesn't exist). */
  oldNo?: number
  newNo?: number
  /** "\ No newline at end of file" follows this line. */
  noNewline?: boolean
}

export interface DiffHunk {
  header: string
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

export function parsePatch(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let current: DiffHunk | undefined
  let oldNo = 0
  let newNo = 0
  // Lines still expected by the current hunk header (blank context lines may have lost their space).
  let oldLeft = 0
  let newLeft = 0
  for (const raw of patch.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw
    const m = HUNK.exec(line)
    if (m) {
      oldNo = Number(m[1])
      newNo = Number(m[3])
      oldLeft = m[2] === undefined ? 1 : Number(m[2])
      newLeft = m[4] === undefined ? 1 : Number(m[4])
      current = { header: line, oldStart: oldNo, newStart: newNo, lines: [] }
      hunks.push(current)
      continue
    }
    if (!current) continue // file headers before the first hunk
    if (line.startsWith("\\")) {
      const last = current.lines[current.lines.length - 1]
      if (last) last.noNewline = true
      continue
    }
    if (oldLeft <= 0 && newLeft <= 0) {
      current = undefined // hunk complete; whatever follows is a header or the next file
      continue
    }
    const sign = line[0]
    if (sign === "+") {
      current.lines.push({ kind: "add", text: line.slice(1), newNo: newNo++ })
      newLeft--
    } else if (sign === "-") {
      current.lines.push({ kind: "del", text: line.slice(1), oldNo: oldNo++ })
      oldLeft--
    } else if (sign === " " || line === "") {
      current.lines.push({ kind: "context", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ })
      oldLeft--
      newLeft--
    } else current = undefined
  }
  return hunks
}

export interface SplitRow {
  left?: DiffLine
  right?: DiffLine
}

/** Side-by-side rows: context on both sides, runs of deletions paired with the following additions. */
export function splitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.kind === "context") {
      rows.push({ left: line, right: line })
      i++
      continue
    }
    const dels: DiffLine[] = []
    const adds: DiffLine[] = []
    while (i < lines.length && lines[i].kind === "del") dels.push(lines[i++])
    while (i < lines.length && lines[i].kind === "add") adds.push(lines[i++])
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ left: dels[k], right: adds[k] })
  }
  return rows
}

/** Old and new file excerpts (for syntax highlighting each side with real context). */
export function sideTexts(hunks: DiffHunk[]) {
  const oldLines: string[] = []
  const newLines: string[] = []
  for (const h of hunks)
    for (const l of h.lines) {
      if (l.kind !== "add") oldLines.push(l.text)
      if (l.kind !== "del") newLines.push(l.text)
    }
  return { oldLines, newLines }
}

export function countChanges(hunks: DiffHunk[]) {
  let additions = 0
  let deletions = 0
  for (const h of hunks)
    for (const l of h.lines) {
      if (l.kind === "add") additions++
      else if (l.kind === "del") deletions++
    }
  return { additions, deletions }
}

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "jsonc",
  md: "markdown",
  mdx: "mdx",
  css: "css",
  scss: "scss",
  html: "html",
  vue: "vue",
  svelte: "svelte",
  py: "python",
  rs: "rust",
  go: "go",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sql: "sql",
  xml: "xml",
  svg: "xml",
  dockerfile: "docker",
  lua: "lua",
  zig: "zig",
}

/** Shiki language for a file path (undefined → plain text). */
export function langForPath(path: string): string | undefined {
  const base = path.split("/").pop()?.toLowerCase() ?? ""
  if (base === "dockerfile") return "docker"
  if (base === "makefile") return "makefile"
  const ext = base.includes(".") ? base.split(".").pop()! : ""
  return EXT_LANG[ext]
}

/**
 * Splits Shiki's `<pre><code><span class="line">…</span>\n…</code></pre>` output into per-line inner HTML.
 * Shiki joins line spans with "\n" and never emits raw newlines inside a line.
 */
export function shikiLines(html: string): string[] {
  const start = html.indexOf("<code>")
  const end = html.lastIndexOf("</code>")
  if (start < 0 || end < 0) return []
  return html
    .slice(start + "<code>".length, end)
    .split("\n")
    .map((line) => line.replace(/^<span class="line">/, "").replace(/<\/span>$/, ""))
}
