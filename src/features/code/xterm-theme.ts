/**
 * xterm.js theme derived from the Opal design tokens on <html> (so it follows light/dark and any
 * token change) — no hardcoded palette. ANSI hues map onto the semantic tokens.
 */
import type { ITheme } from "@xterm/xterm"

function token(styles: CSSStyleDeclaration, name: string, fallback: string) {
  return styles.getPropertyValue(name).trim() || fallback
}

export function xtermTheme(root: HTMLElement = document.documentElement): ITheme {
  const s = getComputedStyle(root)
  const t = (name: string, fallback = "") => token(s, name, fallback)
  const fg = t("--fg", "#141413")
  const bg = t("--bg", "#faf9f5")
  return {
    background: bg,
    foreground: fg,
    cursor: t("--accent", fg),
    cursorAccent: bg,
    selectionBackground: t("--accent-soft", "rgba(217,119,87,0.2)"),
    black: t("--fg-secondary", fg),
    red: t("--danger", fg),
    green: t("--success", fg),
    yellow: t("--warning", fg),
    blue: t("--info", fg),
    magenta: t("--accent", fg),
    cyan: t("--info", fg),
    white: t("--fg-muted", fg),
    brightBlack: t("--fg-muted", fg),
    brightRed: t("--danger", fg),
    brightGreen: t("--success", fg),
    brightYellow: t("--warning", fg),
    brightBlue: t("--info", fg),
    brightMagenta: t("--accent-hover", fg),
    brightCyan: t("--info", fg),
    brightWhite: t("--fg", fg),
  }
}

export function monoFont(root: HTMLElement = document.documentElement) {
  return getComputedStyle(root).getPropertyValue("--font-mono").trim() || "ui-monospace, Menlo, monospace"
}
