import { ChevronRight } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Markdown } from "@/components/markdown/Markdown"
import type { ReasoningPart } from "@/lib/runtime"
import { cn } from "@/lib/utils"
import { useWorkingVerb } from "./working-verbs"

/**
 * Collapsible reasoning: a quiet shimmering label while the model thinks
 * ("Pondering…", rotating), "Thought for 6s" afterwards, and on expand the thinking rendered as
 * formatted markdown (paragraphs, lists, code) that streams in and keeps scrolling to the newest line.
 */
export function ThinkingBlock({ part }: { part: ReasoningPart }) {
  const [open, setOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const verb = useWorkingVerb(!!part.streaming)
  const secs =
    part.time?.completed && part.time.created
      ? Math.max(1, Math.round((part.time.completed - part.time.created) / 1000))
      : undefined
  const label = part.streaming ? verb : secs ? `Thought for ${secs}s` : "Thought process"

  // Follow the stream when the user has the block open.
  useEffect(() => {
    if (!open || !part.streaming) return
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [open, part.streaming, part.text])

  const text = part.text.trim()
  return (
    <div className="my-1.5" data-testid="thinking">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="group/think flex h-7 items-center gap-1.5 text-[13.5px] text-fg-muted transition-colors duration-[120ms] hover:text-fg-secondary"
      >
        <span className={cn(part.streaming && "opal-shimmer")}>{label}</span>
        <ChevronRight className={cn("size-3.5 transition-transform duration-[120ms]", open && "rotate-90")} />
      </button>
      {open ? (
        <div
          ref={bodyRef}
          className={cn(
            "opal-fade-in selectable opal-thinking mb-2 ml-0.5 mt-1 border-l-2 border-border pl-3.5 text-[13.5px] leading-relaxed text-fg-secondary",
            part.streaming && "max-h-80 overflow-y-auto",
          )}
        >
          {text ? (
            <Markdown text={text} streaming={part.streaming} />
          ) : (
            <span className="text-fg-faint">
              {part.streaming ? "Gathering thoughts…" : "No thoughts recorded."}
            </span>
          )}
        </div>
      ) : null}
    </div>
  )
}
