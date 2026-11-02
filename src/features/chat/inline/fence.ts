/**
 * Fence helpers for inline widgets (docs/INLINE-WIDGETS.md §1): the reserved languages, the info
 * string (` ```widget title="Fleet simulator" `) and whether a streaming message ends inside a fence.
 */

export const INLINE_KINDS = ["chart", "widget", "mermaid", "svg"] as const
export type InlineKind = (typeof INLINE_KINDS)[number]

export function isInlineKind(lang: string | undefined | null): lang is InlineKind {
  return !!lang && (INLINE_KINDS as readonly string[]).includes(lang.toLowerCase())
}

export interface FenceInfo {
  /** First word of the info string, lower-cased ("" when absent). */
  lang: string
  /** `title="…"` (or `title='…'` / `title=word`) from the rest of the info string. */
  title?: string
}

/** Parses a full info string (`widget title="Fleet simulator"`). */
export function parseInfoString(info: string | undefined | null): FenceInfo {
  const trimmed = (info ?? "").trim()
  const m = /^(\S+)\s*([\s\S]*)$/.exec(trimmed)
  if (!m) return { lang: "" }
  return { lang: m[1]!.toLowerCase(), title: parseTitle(m[2] ?? "") }
}

/** Extracts `title="…"` from the meta part of an info string (everything after the language). */
export function parseTitle(meta: string | undefined | null): string | undefined {
  if (!meta) return undefined
  const m = /(?:^|\s)title\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|“([^”]*)”|([^\s"']+))/i.exec(meta)
  if (!m) return undefined
  const raw = m[1] ?? m[2] ?? m[3] ?? m[4] ?? ""
  const title = raw.replace(/\\(["'\\])/g, "$1").trim()
  return title ? title.slice(0, 120) : undefined
}

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/

/**
 * Returns the character offset where the last fenced code block of `markdown` starts when that block
 * has not been closed yet (a message still streaming inside a fence), otherwise `undefined`.
 * Follows CommonMark: a closing fence uses the same character, is at least as long as the opening
 * one and has nothing but whitespace after it; backtick info strings may not contain backticks.
 */
export function openFenceOffset(markdown: string): number | undefined {
  let open: { char: string; len: number; offset: number } | undefined
  let offset = 0
  for (const line of markdown.split("\n")) {
    const text = line.endsWith("\r") ? line.slice(0, -1) : line
    if (open) {
      const close = FENCE_CLOSE.exec(text)
      if (close && close[1]![0] === open.char && close[1]!.length >= open.len) open = undefined
    } else {
      const m = FENCE_OPEN.exec(text)
      if (m && !(m[2]![0] === "`" && m[3]!.includes("`"))) {
        open = { char: m[2]![0]!, len: m[2]!.length, offset }
      }
    }
    offset += line.length + 1
  }
  return open?.offset
}

/** True when `markdown` ends inside an unclosed fenced code block. */
export function lastFenceOpen(markdown: string): boolean {
  return openFenceOffset(markdown) !== undefined
}

/** Short, stable (FNV-1a 32-bit) hash used to key iframes by their content. */
export function contentHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + text.length.toString(36)
}
