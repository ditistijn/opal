/**
 * ` ```mermaid ` blocks: a generated document that loads Mermaid from the CDN (same version as the
 * artifact shell public/artifact-runtime/mermaid.html) and renders through the widget shell, so the
 * diagram follows the app theme and never touches the app origin. No pan/zoom chrome inline.
 */
import { memo, useMemo } from "react"
import { mermaidDocument } from "./mermaid-doc"
import { WidgetFrame } from "./WidgetFrame"

export const InlineMermaid = memo(function InlineMermaid({
  source,
  title,
  sessionID,
}: {
  source: string
  title: string
  sessionID?: string
}) {
  const html = useMemo(() => mermaidDocument(source, title), [source, title])
  return <WidgetFrame html={html} title={title} what="diagram" sessionID={sessionID} initialHeight={200} />
})
