/**
 * Generated widget document for ` ```mermaid ` blocks: loads Mermaid from the CDN (same version as the
 * artifact shell public/artifact-runtime/mermaid.html) and renders it through the widget shell.
 */

export const MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@11.12.2/dist/mermaid.esm.min.mjs"

/** JSON string literal that is safe inside an inline <script>. */
function scriptString(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replaceAll(String.fromCharCode(0x2028), "\\u2028")
    .replaceAll(String.fromCharCode(0x2029), "\\u2029")
}

function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** The widget document for a Mermaid source. Theme-independent: it reads the shell's data-theme. */
export function mermaidDocument(source: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  body { padding: 12px 4px 8px; }
  #diagram { display: flex; justify-content: center; min-height: 40px; }
  #diagram svg { max-width: 100%; height: auto; }
</style>
</head>
<body>
<div id="diagram" role="img" aria-label="${escapeAttr(title)}"></div>
<script type="module">
  const source = ${scriptString(source)}
  const dark = document.documentElement.getAttribute("data-theme") === "dark"
  try {
    const { default: mermaid } = await import(${scriptString(MERMAID_URL)})
    // Opal tokens (hex, as the Mermaid theming engine requires) injected by the widget shell
    const css = getComputedStyle(document.documentElement)
    const token = (name, fallback) => {
      const v = css.getPropertyValue(name).trim()
      return /^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback
    }
    const fg = token("--fg", dark ? "#f0eee6" : "#141413")
    const muted = token("--bg-muted", dark ? "#2b2a28" : "#f3f1ea")
    const inset = token("--bg-inset", dark ? "#3a3936" : "#e8e6dc")
    const surface = token("--bg-elevated", dark ? "#30302e" : "#ffffff")
    const line = token("--fg-muted", dark ? "#8b8980" : "#87867f")
    const faint = token("--fg-faint", dark ? "#5f5d57" : "#b4b2a9")
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: getComputedStyle(document.body).fontFamily,
      themeVariables: {
        darkMode: dark,
        background: surface,
        fontSize: "14px",
        primaryColor: muted,
        primaryTextColor: fg,
        primaryBorderColor: faint,
        secondaryColor: inset,
        tertiaryColor: surface,
        mainBkg: muted,
        nodeBorder: faint,
        clusterBkg: surface,
        clusterBorder: faint,
        lineColor: line,
        textColor: fg,
        edgeLabelBackground: surface,
        noteBkgColor: inset,
        noteTextColor: fg,
        noteBorderColor: faint,
        actorBkg: muted,
        actorBorder: faint,
        actorTextColor: fg,
        signalColor: line,
        signalTextColor: fg,
      },
    })
    const { svg } = await mermaid.render("opal-inline-diagram", source)
    document.getElementById("diagram").innerHTML = svg
  } catch (err) {
    // mermaid leaves a stray error svg in the body
    document.querySelectorAll("body > [id^='dopal-inline-diagram']").forEach((n) => n.remove())
    parent.postMessage({
      type: "opal:error",
      message: err && err.message ? String(err.message) : String(err),
      stack: err && err.stack ? String(err.stack) : "",
      phase: "transpile",
    }, "*")
  }
</script>
</body>
</html>`
}
