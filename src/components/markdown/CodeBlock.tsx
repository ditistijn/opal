import { Check, Copy } from "lucide-react"
import { memo, useEffect, useState } from "react"
import { useCopy } from "@/hooks/use-copy"
import { cn } from "@/lib/utils"
import { highlightCode, normalizeLang } from "./shiki"

const HIGHLIGHT = import.meta.env.MODE !== "test"

/** Fenced code block: language label, copy button, lazily Shiki-highlighted body. */
export const CodeBlock = memo(function CodeBlock({
  code,
  lang,
  streaming,
}: {
  code: string
  lang?: string
  streaming?: boolean
}) {
  const [html, setHtml] = useState<string | null>(null)
  const { copied, copy } = useCopy()

  useEffect(() => {
    if (!HIGHLIGHT || streaming) return
    let alive = true
    highlightCode(code, lang)
      .then((out) => alive && setHtml(out))
      .catch(() => alive && setHtml(null))
    return () => {
      alive = false
    }
  }, [code, lang, streaming])

  const label = normalizeLang(lang) || "text"
  return (
    <div
      className="opal-code group/code my-4 overflow-hidden rounded-lg border border-border bg-bg-muted"
      data-lang={label}
    >
      <div className="flex h-8 items-center justify-between border-b border-border pl-3.5 pr-1.5">
        <span className="font-sans text-xs text-fg-muted">{label}</span>
        <button
          type="button"
          onClick={() => copy(code)}
          aria-label="Copy code"
          className="flex h-6 items-center gap-1 rounded-sm px-1.5 font-sans text-xs text-fg-muted transition-fast hover:bg-bg-inset hover:text-fg"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {html ? (
        <div className="selectable overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className={cn("selectable overflow-x-auto")}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
})
