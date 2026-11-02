/** Lazy Shiki highlighting for the artifact code view (dual light/dark themes via CSS variables). */
const MAX_HIGHLIGHT_BYTES = 300_000

export async function highlightCode(code: string, lang: string): Promise<string | undefined> {
  if (code.length > MAX_HIGHLIGHT_BYTES) return undefined
  const shiki = await import("shiki")
  const opts = { themes: { light: "github-light", dark: "github-dark" }, defaultColor: false as const }
  try {
    return await shiki.codeToHtml(code, { lang, ...opts })
  } catch {
    return shiki.codeToHtml(code, { lang: "text", ...opts })
  }
}
