/**
 * Lazily-loaded Shiki highlighter shared by every code block. Highlighting is dual-theme:
 * spans carry --shiki-light / --shiki-dark and markdown.css picks one from <html data-theme>.
 */
import type { BundledLanguage, Highlighter } from "shiki"

let highlighter: Promise<Highlighter> | null = null
const loaded = new Set<string>()

const ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  rs: "rust",
  yml: "yaml",
  md: "markdown",
  golang: "go",
  "c++": "cpp",
  cs: "csharp",
  kt: "kotlin",
}

export function normalizeLang(lang: string | undefined) {
  const l = (lang ?? "").toLowerCase().trim()
  return ALIASES[l] ?? l
}

async function getHighlighter() {
  highlighter ??= import("shiki").then(({ createHighlighter }) =>
    createHighlighter({ themes: ["github-light", "github-dark"], langs: [] }),
  )
  return highlighter
}

/** Returns highlighted HTML (a <pre class="shiki">), or null when the language is unknown. */
export async function highlightCode(code: string, lang: string | undefined): Promise<string | null> {
  const name = normalizeLang(lang)
  if (!name || name === "text" || name === "plaintext") return null
  const { bundledLanguages } = await import("shiki")
  if (!(name in bundledLanguages)) return null
  const hl = await getHighlighter()
  if (!loaded.has(name)) {
    await hl.loadLanguage(name as BundledLanguage)
    loaded.add(name)
  }
  return hl.codeToHtml(code, {
    lang: name,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  })
}
