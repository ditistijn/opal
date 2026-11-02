import { ArrowDown } from "lucide-react"
import { useEffect, useMemo } from "react"
import { useStickToBottom } from "@/hooks/use-stick-to-bottom"
import type { ChatMessage } from "@/lib/runtime"
import { cn } from "@/lib/utils"
import { AssistantTurn } from "./AssistantMessage"
import { UserMessage } from "./UserMessage"

export type TranscriptBlock =
  { kind: "user"; message: ChatMessage } | { kind: "turn"; id: string; messages: ChatMessage[] }

/**
 * Groups the visible transcript into user messages and assistant turns. OpenCode emits one assistant
 * message per step, so consecutive assistant messages (until the next user message) form one turn.
 */
export function transcriptBlocks(messages: ChatMessage[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = []
  for (const m of messages) {
    if (m.role === "user") blocks.push({ kind: "user", message: m })
    else if (m.role === "assistant") {
      const prev = blocks[blocks.length - 1]
      if (prev?.kind === "turn") prev.messages.push(m)
      else blocks.push({ kind: "turn", id: m.id, messages: [m] })
    }
  }
  return blocks
}

/** Scrollable transcript with stick-to-bottom and a "scroll to bottom" pill. */
export function MessageList({
  messages,
  busy,
  readOnly,
}: {
  messages: ChatMessage[]
  busy: boolean
  /** Hide edit/retry affordances (e.g. a subagent transcript viewed from its parent). */
  readOnly?: boolean
}) {
  const { scrollRef, contentRef, atBottom, scrollToBottom } = useStickToBottom()
  const blocks = useMemo(() => transcriptBlocks(messages), [messages])
  const lastUserCount = blocks.filter((b) => b.kind === "user").length
  const lastBlock = blocks[blocks.length - 1]

  // Jump to the bottom when the conversation opens and whenever the user sends a message.
  useEffect(() => {
    scrollToBottom()
  }, [lastUserCount, scrollToBottom])

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} className="h-full overflow-y-auto" data-testid="message-scroll">
        <div ref={contentRef} className="mx-auto w-full max-w-[var(--content-max-width)] px-6 pb-10 pt-4">
          <div className="space-y-5">
            {blocks.map((b) =>
              b.kind === "user" ? (
                <UserMessage key={b.message.id} message={b.message} canEdit={!busy && !readOnly} />
              ) : (
                <AssistantTurn
                  key={b.id}
                  messages={b.messages}
                  isLast={!readOnly && b === lastBlock}
                  busy={busy && b === lastBlock}
                />
              ),
            )}
            {busy && lastBlock?.kind === "user" ? <div className="h-7" aria-hidden /> : null}
          </div>
        </div>
      </div>
      <button
        type="button"
        aria-label="Scroll to bottom"
        onClick={() => scrollToBottom(true)}
        className={cn(
          "absolute bottom-3 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-bg-elevated text-fg-secondary shadow-elevated transition-[opacity,transform] duration-[120ms] hover:text-fg",
          atBottom ? "pointer-events-none translate-y-1 opacity-0" : "opacity-100",
        )}
        tabIndex={atBottom ? -1 : 0}
      >
        <ArrowDown className="size-4" />
      </button>
    </div>
  )
}
