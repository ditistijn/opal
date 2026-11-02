import {
  createContext,
  memo,
  useContext,
  useMemo,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { isInlineKind, openFenceOffset, parseTitle } from "@/features/chat/inline/fence"
import { InlineBlock } from "@/features/chat/inline/InlineBlock"
import { cn, isTauri } from "@/lib/utils"
import { CodeBlock } from "./CodeBlock"
import "./markdown.css"

/*
 * Raw HTML in model output is intentionally NOT rendered (no rehype-raw): react-markdown
 * escapes it, which is the safe default for untrusted text.
 */

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as ReactElement<{ children?: ReactNode }>).props.children)
  }
  return ""
}

async function openExternal(href: string) {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener")
    await openUrl(href)
  } else window.open(href, "_blank", "noopener,noreferrer")
}

interface MarkdownContextValue {
  streaming: boolean
  sessionID?: string
  /** Start offset of a fence that has not been closed yet (only while streaming). */
  openFence?: number
}

/**
 * Per-message data for the renderers. One static `components` object reads it, so the element types
 * stay the same when streaming ends and inline widgets (iframes) are not remounted.
 */
const MarkdownContext = createContext<MarkdownContextValue>({ streaming: false })

const components: Components = {
  pre({ children, node }) {
    const ctx = useContext(MarkdownContext)
    const child = Array.isArray(children) ? children[0] : children
    const props = (child as ReactElement<{ className?: string; children?: ReactNode }>)?.props ?? {}
    const lang = /language-([\w+#-]+)/.exec(props.className ?? "")?.[1]
    const code = textOf(props.children).replace(/\n$/, "")
    if (isInlineKind(lang)) {
      const codeNode = node?.children[0]
      const meta = codeNode?.type === "element" ? codeNode.data?.meta : undefined
      const start = node?.position?.start.offset
      const open = ctx.openFence !== undefined && start !== undefined && start >= ctx.openFence
      return (
        <InlineBlock
          kind={lang.toLowerCase() as typeof lang}
          code={code}
          title={parseTitle(meta)}
          open={open}
          sessionID={ctx.sessionID}
        />
      )
    }
    return <CodeBlock code={code} lang={lang} streaming={ctx.streaming} />
  },
  code({ className, children, ...rest }: ComponentProps<"code"> & { node?: unknown }) {
    delete (rest as { node?: unknown }).node
    return (
      <code className={cn("opal-inline-code", className)} {...rest}>
        {children}
      </code>
    )
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        onClick={(e) => {
          if (!href || href.startsWith("#")) return
          e.preventDefault()
          void openExternal(href)
        }}
      >
        {children}
      </a>
    )
  },
  table({ children }) {
    return (
      <div className="opal-table">
        <table>{children}</table>
      </div>
    )
  },
}

/** Prose renderer for assistant messages (GFM, highlighted code, safe links). */
export const Markdown = memo(function Markdown({
  text,
  streaming,
  className,
  sessionID,
}: {
  text: string
  streaming?: boolean
  className?: string
  /** Conversation of the message (inline widgets send prompts to it). */
  sessionID?: string
}) {
  const openFence = streaming ? openFenceOffset(text) : undefined
  const ctx = useMemo(
    () => ({ streaming: !!streaming, sessionID, openFence }),
    [streaming, sessionID, openFence],
  )
  return (
    <div className={cn("opal-md selectable", streaming && "opal-streaming", className)}>
      <MarkdownContext.Provider value={ctx}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {text}
        </ReactMarkdown>
      </MarkdownContext.Provider>
    </div>
  )
})
