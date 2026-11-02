import { useEffect, useMemo, useState } from "react"
import { highlightCode } from "@/components/markdown/shiki"
import { cn } from "@/lib/utils"
import {
  langForPath,
  parsePatch,
  shikiLines,
  sideTexts,
  splitRows,
  type DiffHunk,
  type DiffLine,
} from "./diff-parse"

export type DiffMode = "unified" | "split"

/** Skip highlighting very large diffs (plain monospace is still readable and much cheaper). */
const HIGHLIGHT_LIMIT = 3000

interface Highlighted {
  old: string[]
  new: string[]
}

function useHighlight(hunks: DiffHunk[], path: string): Highlighted | undefined {
  const [out, setOut] = useState<Highlighted>()
  useEffect(() => {
    setOut(undefined)
    const lang = langForPath(path)
    const { oldLines, newLines } = sideTexts(hunks)
    if (!lang || oldLines.length + newLines.length > HIGHLIGHT_LIMIT) return
    let live = true
    Promise.all([
      oldLines.length ? highlightCode(oldLines.join("\n"), lang) : Promise.resolve(""),
      newLines.length ? highlightCode(newLines.join("\n"), lang) : Promise.resolve(""),
    ])
      .then(([o, n]) => {
        if (!live || o === null || n === null) return
        setOut({ old: o ? shikiLines(o) : [], new: n ? shikiLines(n) : [] })
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [hunks, path])
  return out
}

/** Maps each diff line to its highlighted HTML (by position in the old/new side texts). */
function useLineHtml(hunks: DiffHunk[], hl: Highlighted | undefined) {
  return useMemo(() => {
    const map = new Map<DiffLine, string>()
    if (!hl) return map
    let o = 0
    let n = 0
    for (const h of hunks)
      for (const l of h.lines) {
        if (l.kind === "del") map.set(l, hl.old[o++] ?? "")
        else if (l.kind === "add") map.set(l, hl.new[n++] ?? "")
        else {
          map.set(l, hl.new[n] ?? "")
          o++
          n++
        }
      }
    return map
  }, [hunks, hl])
}

function Code({ line, html }: { line: DiffLine; html?: string }) {
  if (html !== undefined && html !== "") return <span dangerouslySetInnerHTML={{ __html: html }} />
  return <span>{line.text || " "}</span>
}

const SIGN: Record<DiffLine["kind"], string> = { add: "+", del: "−", context: " " }

function UnifiedHunk({ hunk, html }: { hunk: DiffHunk; html: Map<DiffLine, string> }) {
  return (
    <>
      <tr className="opal-diff-hunk">
        <td colSpan={4} className="px-3 py-1 font-mono text-[11.5px] text-fg-muted">
          {hunk.header}
        </td>
      </tr>
      {hunk.lines.map((l, i) => (
        <tr key={i} className={cn("opal-diff-line", `is-${l.kind}`)}>
          <td className="opal-diff-no">{l.oldNo ?? ""}</td>
          <td className="opal-diff-no">{l.newNo ?? ""}</td>
          <td className="opal-diff-sign">{SIGN[l.kind]}</td>
          <td className="opal-diff-code">
            <Code line={l} html={html.get(l)} />
          </td>
        </tr>
      ))}
    </>
  )
}

function SplitHunk({ hunk, html }: { hunk: DiffHunk; html: Map<DiffLine, string> }) {
  const rows = useMemo(() => splitRows(hunk.lines), [hunk])
  const cell = (l: DiffLine | undefined, side: "left" | "right") => {
    const kind = !l ? "empty" : l.kind
    return (
      <>
        <td className={cn("opal-diff-no", `is-${kind}`)}>{l ? (side === "left" ? l.oldNo : l.newNo) : ""}</td>
        <td
          className={cn(
            "opal-diff-code opal-diff-half",
            `is-${kind}`,
            side === "left" && "border-r border-border",
          )}
        >
          {l ? <Code line={l} html={html.get(l)} /> : null}
        </td>
      </>
    )
  }
  return (
    <>
      <tr className="opal-diff-hunk">
        <td colSpan={4} className="px-3 py-1 font-mono text-[11.5px] text-fg-muted">
          {hunk.header}
        </td>
      </tr>
      {rows.map((r, i) => (
        <tr key={i} className="opal-diff-line">
          {cell(r.left, "left")}
          {cell(r.right, "right")}
        </tr>
      ))}
    </>
  )
}

/** Renders a unified patch (one file) as a unified or side-by-side table with syntax colouring. */
export function DiffView({
  patch,
  path,
  mode = "unified",
}: {
  patch: string
  path: string
  mode?: DiffMode
}) {
  const hunks = useMemo(() => parsePatch(patch), [patch])
  const hl = useHighlight(hunks, path)
  const html = useLineHtml(hunks, hl)
  if (!hunks.length)
    return (
      <div className="px-3 py-2 text-[12px] text-fg-muted">
        No textual changes (binary file or mode change).
      </div>
    )
  return (
    <div className="opal-diff opal-code selectable overflow-x-auto" data-mode={mode}>
      <table
        className={cn(
          "w-full border-collapse font-mono text-[12px] leading-[18px]",
          mode === "split" && "table-fixed",
        )}
      >
        {mode === "split" ? (
          <colgroup>
            <col className="w-10" />
            <col />
            <col className="w-10" />
            <col />
          </colgroup>
        ) : null}
        <tbody className="shiki">
          {hunks.map((h, i) =>
            mode === "split" ? (
              <SplitHunk key={i} hunk={h} html={html} />
            ) : (
              <UnifiedHunk key={i} hunk={h} html={html} />
            ),
          )}
        </tbody>
      </table>
    </div>
  )
}
