import { Fragment } from "react"
import { Markdown } from "@/components/markdown/Markdown"
import { runtime, type ChatMessage } from "@/lib/runtime"
import { cn } from "@/lib/utils"
import { ArtifactCard } from "./ArtifactCard"
import { CopyAction, RetryAction } from "./MessageActions"
import { OpalGlyph } from "./OpalGlyph"
import { ThinkingBlock } from "./ThinkingBlock"
import { useWorkingVerb } from "./working-verbs"
import { isArtifactTool } from "./tool-labels"
import { ToolRow } from "./ToolRow"
import { messageText } from "./UserMessage"

function compact(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n)
}

type Usage = Pick<ChatMessage, "tokens" | "cost">

export function usageLabel(m: Usage) {
  const bits: string[] = []
  if (m.tokens) bits.push(`${compact(m.tokens.input)} in`, `${compact(m.tokens.output)} out`)
  if (m.cost !== undefined && m.cost > 0)
    bits.push(`$${m.cost < 0.01 ? m.cost.toFixed(4) : m.cost.toFixed(2)}`)
  return bits.join(" · ")
}

/** Sums tokens and cost over the steps of one turn (each OpenCode step reports its own usage). */
export function turnUsage(messages: ChatMessage[]): Usage {
  let tokens: Usage["tokens"]
  let cost: number | undefined
  for (const m of messages) {
    if (m.tokens)
      tokens = {
        input: (tokens?.input ?? 0) + m.tokens.input,
        output: (tokens?.output ?? 0) + m.tokens.output,
      }
    if (m.cost !== undefined) cost = (cost ?? 0) + m.cost
  }
  return { tokens, cost }
}

/** The text of a whole turn (all steps), as copied by the footer's Copy action. */
export function turnText(messages: ChatMessage[]) {
  return messages
    .map(messageText)
    .filter((t) => t.trim())
    .join("\n\n")
}

/**
 * One assistant step (OpenCode emits one assistant message per step / tool round): thinking, tool rows,
 * artifact cards, markdown and any error. No footer — the turn renders one footer after its last step.
 */
export function AssistantMessage({
  message,
  recovered = false,
}: {
  message: ChatMessage
  recovered?: boolean
}) {
  return (
    <div data-role="assistant" data-streaming={message.streaming || undefined}>
      {message.parts.map((part, i) => (
        <Fragment key={part.type === "tool" ? part.id : `${part.type}-${i}`}>
          {part.type === "text" ? (
            <Markdown
              text={part.text}
              streaming={part.streaming}
              sessionID={message.sessionID}
              className="my-1"
            />
          ) : part.type === "reasoning" ? (
            <ThinkingBlock part={part} />
          ) : isArtifactTool(part.name) ? (
            <ArtifactCard part={part} sessionID={message.sessionID} />
          ) : (
            <ToolRow part={part} />
          )}
        </Fragment>
      ))}

      {message.error && recovered ? (
        // A step that failed but was retried / followed by more work: a quiet note, not a red box.
        <div
          data-testid="recovered-error"
          title={message.error}
          className="mt-2 flex items-center gap-1.5 text-[12.5px] text-fg-muted"
        >
          <span className="size-1.5 rounded-full bg-warning" />
          Connection hiccup, retried
        </div>
      ) : message.error ? (
        <div role="alert" className="mt-3 rounded-lg bg-danger-soft px-3.5 py-2.5 text-[13.5px] text-danger">
          {message.error}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Consecutive assistant steps between two user messages, read as one continuous response with a single
 * footer toolbar (copy the whole turn, retry, summed usage) after the last step.
 * `busy` (the session is still working on this turn) keeps the footer in its working state between steps.
 */
export function AssistantTurn({
  messages,
  isLast,
  busy = false,
}: {
  messages: ChatMessage[]
  isLast: boolean
  busy?: boolean
}) {
  const last = messages[messages.length - 1]
  const streaming = busy || messages.some((m) => m.streaming)
  const text = turnText(messages)
  const empty = messages.every((m) => m.parts.length === 0)
  const usage = usageLabel(turnUsage(messages))
  // Between steps (tools running, next step pending) there is no reasoning part to carry the status, so the
  // footer shows a rotating verb next to the animated glyph.
  const working = useWorkingVerb(streaming)
  const thinkingVisible =
    streaming && messages.some((m) => m.parts.some((p) => p.type === "reasoning" && p.streaming))

  return (
    <div className="group/msg relative" data-role="assistant-turn" data-streaming={streaming || undefined}>
      {messages.map((m, i) => (
        // An error on any step but the last, or on a turn that is still running (OpenCode retries the
        // step), was recovered from; only the turn's final failure is shown as an alert.
        <AssistantMessage key={m.id} message={m} recovered={i < messages.length - 1 || streaming} />
      ))}

      <div
        data-testid="turn-footer"
        className={cn("mt-2 flex h-7 items-center gap-0.5", empty && streaming && "mt-0")}
      >
        {isLast || streaming ? <OpalGlyph animated={streaming} className="mr-2 size-[22px]" /> : null}
        {streaming && !thinkingVisible ? (
          <span className="opal-shimmer text-[13px] text-fg-muted" data-testid="working-verb">
            {working}
          </span>
        ) : null}
        {!streaming ? (
          <div
            className={cn(
              "flex items-center gap-0.5 transition-opacity duration-[120ms]",
              isLast ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100",
            )}
          >
            {text ? <CopyAction text={text} /> : null}
            {isLast ? <RetryAction onClick={() => runtime.regenerate(last.sessionID)} /> : null}
            {usage ? (
              <span className="ml-2 text-[11.5px] tabular-nums text-fg-faint opacity-0 transition-opacity duration-[120ms] group-hover/msg:opacity-100">
                {usage}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
