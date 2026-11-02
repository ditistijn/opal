/**
 * Inline widgets inside assistant messages (docs/INLINE-WIDGETS.md): the card chrome and the
 * dispatcher from fence language to renderer. Charts load Recharts lazily so the chat bundle stays small.
 */
import { Code2, TriangleAlert } from "lucide-react"
import { lazy, memo, Suspense, useMemo, useState, type ReactNode } from "react"
import { CodeBlock } from "@/components/markdown/CodeBlock"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { parseChartSpec } from "./chart-spec"
import type { InlineKind } from "./fence"
import { InlineMermaid } from "./InlineMermaid"
import { InlineSvg, sanitizeSvg } from "./InlineSvg"
import { WidgetFrame } from "./WidgetFrame"
import "../chat.css"
import "./inline.css"

const InlineChart = lazy(() => import("./InlineChart"))

const KIND_LABEL: Record<InlineKind, string> = {
  chart: "Chart",
  widget: "Widget",
  mermaid: "Diagram",
  svg: "Image",
}

const PLACEHOLDER: Record<InlineKind, string> = {
  chart: "Drawing chart…",
  widget: "Building widget…",
  mermaid: "Drawing diagram…",
  svg: "Drawing image…",
}

/** Language for the Source view's highlighter. */
const SOURCE_LANG: Record<InlineKind, string> = {
  chart: "json",
  widget: "html",
  mermaid: "mermaid",
  svg: "xml",
}

export interface InlineBlockProps {
  kind: InlineKind
  /** Body of the fence. */
  code: string
  /** `title="…"` from the info string. */
  title?: string
  /** The fence is still streaming (closing ``` not received yet): show the placeholder. */
  open?: boolean
  /** Conversation the message belongs to (widget prompts, "Ask Opal to fix"). */
  sessionID?: string
}

/** Renders one reserved fence. Memoised on its props, so re-rendering the same text is a no-op. */
export const InlineBlock = memo(function InlineBlock({
  kind,
  code,
  title,
  open,
  sessionID,
}: InlineBlockProps) {
  if (open) return <InlinePlaceholder kind={kind} title={title} />
  switch (kind) {
    case "chart":
      return <ChartBlock code={code} />
    case "svg":
      return <SvgBlock code={code} title={title} />
    case "mermaid":
      return (
        <InlineCard kind={kind} title={title} code={code}>
          <InlineMermaid source={code} title={title ?? "Diagram"} sessionID={sessionID} />
        </InlineCard>
      )
    case "widget":
      return (
        <InlineCard kind={kind} title={title} code={code}>
          <WidgetFrame
            html={code}
            title={title ?? "Interactive widget"}
            what="widget"
            sessionID={sessionID}
          />
        </InlineCard>
      )
  }
})

function ChartBlock({ code }: { code: string }) {
  const parsed = useMemo(() => parseChartSpec(code), [code])
  if (!parsed.ok)
    return <InvalidBlock kind="chart" code={code} error={`Not a valid chart: ${parsed.error}`} />
  const { spec } = parsed
  return (
    <InlineCard kind="chart" title={spec.title} subtitle={spec.subtitle} note={spec.note} code={code}>
      <Suspense fallback={<ChartSkeleton />}>
        <InlineChart spec={spec} />
      </Suspense>
    </InlineCard>
  )
}

function SvgBlock({ code, title }: { code: string; title?: string }) {
  const result = useMemo(() => sanitizeSvg(code), [code])
  if (!result.ok) return <InvalidBlock kind="svg" code={code} error={`Not a valid SVG: ${result.error}`} />
  return (
    <InlineCard kind="svg" title={title} code={code}>
      <InlineSvg svg={result} title={title ?? "Image"} />
    </InlineCard>
  )
}

/** Invalid content is never an empty card: the raw block as code with a short note. */
function InvalidBlock({ kind, code, error }: { kind: InlineKind; code: string; error: string }) {
  return (
    <div className="opal-inline" data-inline-kind={kind} data-inline-invalid="">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] text-fg-muted" role="note">
        <TriangleAlert className="size-3.5 shrink-0 text-warning" />
        <span className="min-w-0 break-words">{error}</span>
      </div>
      <div className="[&_.opal-code]:my-0">
        <CodeBlock code={code} lang={SOURCE_LANG[kind]} />
      </div>
    </div>
  )
}

function KindBadge({ kind }: { kind: InlineKind }) {
  return (
    <span className="shrink-0 rounded-[5px] bg-bg-muted px-1.5 py-px text-[11px] font-medium leading-4 text-fg-muted">
      {KIND_LABEL[kind]}
    </span>
  )
}

function CardHeader({ kind, title, subtitle }: { kind: InlineKind; title?: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-2 px-4 pb-1 pt-3">
      <div className="min-w-0 flex-1">
        {title ? (
          <div className="truncate text-[14px] font-medium leading-5 text-fg" data-testid="inline-title">
            {title}
          </div>
        ) : null}
        {subtitle ? <div className="text-[12.5px] leading-5 text-fg-muted">{subtitle}</div> : null}
      </div>
      <KindBadge kind={kind} />
    </div>
  )
}

export function InlineCard({
  kind,
  title,
  subtitle,
  note,
  code,
  children,
}: {
  kind: InlineKind
  title?: string
  subtitle?: string
  note?: string
  /** Raw fence body for the Source view. */
  code: string
  children: ReactNode
}) {
  const [showSource, setShowSource] = useState(false)
  return (
    <figure
      className="opal-inline overflow-hidden rounded-xl border border-border bg-bg-elevated"
      data-inline-kind={kind}
      aria-label={title ?? KIND_LABEL[kind]}
    >
      <CardHeader kind={kind} title={title} subtitle={subtitle} />
      <div className="px-4 pb-1 pt-2">{children}</div>
      <div className="flex min-h-9 items-center gap-2 py-1.5 pl-4 pr-2">
        <div className="min-w-0 flex-1 text-[12.5px] leading-5 text-fg-muted">{note}</div>
        <Button
          size="xs"
          variant="ghost"
          aria-expanded={showSource}
          onClick={() => setShowSource((v) => !v)}
          className="text-fg-muted"
        >
          <Code2 />
          {showSource ? "Hide source" : "Source"}
        </Button>
      </div>
      {showSource ? <CodeBlock code={code} lang={SOURCE_LANG[kind]} /> : null}
    </figure>
  )
}

/** Shown while the fence is still streaming: never a partial chart or widget. */
export function InlinePlaceholder({ kind, title }: { kind: InlineKind; title?: string }) {
  return (
    <div
      className="opal-inline overflow-hidden rounded-xl border border-border bg-bg-elevated"
      data-inline-kind={kind}
      data-inline-placeholder=""
    >
      <CardHeader kind={kind} title={title} />
      <div className="flex h-[140px] items-center justify-center px-4 pb-4" role="status">
        <span className="opal-shimmer text-[13px]">{PLACEHOLDER[kind]}</span>
      </div>
    </div>
  )
}

function ChartSkeleton() {
  return (
    <div className="flex h-[280px] flex-col justify-end gap-2 pb-6" role="status" aria-label="Loading chart">
      <div className={cn("opal-inline-skeleton h-full w-full rounded-lg opacity-60")} />
    </div>
  )
}
