/**
 * Live message projection: persisted messages (./map.ts) + SSE events → ChatMessage[].
 *
 * Semantics mirror upstream's reference reducer (packages/client/src/solid/data.ts) and the event
 * schema (packages/schema/src/session-event.ts, v2.2.5):
 *  - each `session.step.started` opens one assistant message (id = assistantMessageID);
 *  - text/reasoning chunks are addressed by (message, kind, ordinal) — ordinals count per kind
 *    within a step; tool calls by (message, tool id); parts are appended in start order, which is
 *    the order the server persists them in;
 *  - user/synthetic messages appear via `session.inbox.enqueued`, are re-timed on delivery and
 *    removed on cancel; `session.revert.committed` drops every message with id >= `to`.
 *
 * Performance: events are applied in batches through a Draft. The messages array is copied at most
 * once per batch and each touched message/part once per batch; a delta is then an O(1) lookup plus
 * a string append on a batch-owned part. Handlers are idempotent so events that raced a
 * `message.list` load can be replayed on top of it.
 */
import type { OpenCodeEvent } from "@/lib/opencode/types"
import type { ChatMessage, MessagePart, ReasoningPart, TextPart, ToolPart } from "./contracts"
import { mapMessages, parseToolInput, toolOutput, userAttachments, userText } from "./map"

export interface Projection {
  readonly messages: ChatMessage[]
  /** messageID → position in `messages`. */
  readonly index: Map<string, number>
  /** partKey(...) → position in that message's `parts`. */
  readonly parts: Map<string, number>
}

type Kind = "text" | "reasoning" | "tool"

export function partKey(messageID: string, kind: Kind, key: number | string) {
  return `${messageID}\u0000${kind}\u0000${key}`
}

export function emptyProjection(): Projection {
  return { messages: [], index: new Map(), parts: new Map() }
}

function indexParts(parts: Map<string, number>, message: ChatMessage) {
  const ordinals = { text: 0, reasoning: 0 }
  message.parts.forEach((part, position) => {
    if (part.type === "tool") parts.set(partKey(message.id, "tool", part.id), position)
    else parts.set(partKey(message.id, part.type, ordinals[part.type]++), position)
  })
}

export function projectionFrom(messages: ChatMessage[]): Projection {
  const index = new Map<string, number>()
  const parts = new Map<string, number>()
  messages.forEach((message, position) => {
    index.set(message.id, position)
    indexParts(parts, message)
  })
  return { messages, index, parts }
}

export function projectionFromList(list: Parameters<typeof mapMessages>[0], sessionID: string) {
  return projectionFrom(mapMessages(list, sessionID))
}

/** Batch-scoped mutable view over a Projection (copy-on-write). */
class Draft {
  private list: ChatMessage[] | undefined
  private readonly fresh = new WeakSet<object>()
  readonly index: Map<string, number>
  readonly parts: Map<string, number>

  constructor(private readonly base: Projection) {
    this.index = base.index
    this.parts = base.parts
  }

  get messages(): readonly ChatMessage[] {
    return this.list ?? this.base.messages
  }

  private writable(): ChatMessage[] {
    if (!this.list) this.list = this.base.messages.slice()
    return this.list
  }

  has(id: string) {
    return this.index.has(id)
  }

  /** A mutable copy of the message (first touch in this batch clones it and its parts array). */
  message(id: string): ChatMessage | undefined {
    const position = this.index.get(id)
    if (position === undefined) return undefined
    const list = this.writable()
    let message = list[position]
    if (!message) return undefined
    if (!this.fresh.has(message)) {
      message = { ...message, parts: message.parts.slice() }
      this.fresh.add(message)
      list[position] = message
    }
    return message
  }

  /** A mutable copy of `message.parts[position]` (message must come from `this.message`). */
  part<T extends MessagePart>(message: ChatMessage, position: number): T | undefined {
    let part = message.parts[position]
    if (!part) return undefined
    if (!this.fresh.has(part)) {
      part = part.type === "tool" ? { ...part, time: { ...part.time } } : { ...part }
      this.fresh.add(part)
      message.parts[position] = part
    }
    return part as T
  }

  /** Appends a part and registers its key; returns the mutable part. */
  addPart<T extends MessagePart>(message: ChatMessage, key: string, part: T): T {
    this.fresh.add(part)
    this.parts.set(key, message.parts.length)
    message.parts.push(part)
    return part
  }

  findPart<T extends MessagePart>(
    messageID: string,
    key: string,
  ): { message: ChatMessage; part: T } | undefined {
    const position = this.parts.get(key)
    if (position === undefined) return undefined
    const message = this.message(messageID)
    if (!message) return undefined
    const part = this.part<T>(message, position)
    return part ? { message, part } : undefined
  }

  append(message: ChatMessage) {
    if (this.index.has(message.id)) return
    const list = this.writable()
    this.fresh.add(message)
    this.index.set(message.id, list.length)
    indexParts(this.parts, message)
    list.push(message)
  }

  /** Moves a message to the end (inbox delivery order). */
  moveToEnd(id: string, created: number) {
    const position = this.index.get(id)
    const message = this.message(id)
    if (position === undefined || !message) return
    message.created = created
    const list = this.writable()
    if (position === list.length - 1) return
    list.splice(position, 1)
    list.push(message)
    this.rebuildIndex()
  }

  removeWhere(predicate: (message: ChatMessage) => boolean) {
    const list = this.writable()
    const kept = list.filter((message) => !predicate(message))
    if (kept.length === list.length) return
    this.list = kept
    this.rebuildIndex()
  }

  private rebuildIndex() {
    this.index.clear()
    this.list!.forEach((message, position) => this.index.set(message.id, position))
  }

  /** The last assistant message that has not completed. */
  activeAssistant(): ChatMessage | undefined {
    const list = this.messages
    for (let i = list.length - 1; i >= 0; i--) {
      const message = list[i]!
      if (message.role === "assistant") return message.streaming ? this.message(message.id) : undefined
    }
    return undefined
  }

  finish(): Projection {
    if (!this.list) return this.base
    return { messages: this.list, index: this.index, parts: this.parts }
  }
}

function closeStreaming(draft: Draft, message: ChatMessage, completed: number) {
  message.streaming = undefined
  message.completed ??= completed
  message.parts.forEach((part, position) => {
    if (part.type === "tool") return
    if (!part.streaming) return
    const mutable = draft.part<TextPart | ReasoningPart>(message, position)
    if (!mutable) return
    mutable.streaming = false
    if (mutable.type === "reasoning")
      mutable.time = { created: mutable.time?.created ?? completed, completed }
  })
}

/** Marks every still-streaming assistant message finished (execution ended / session idle). */
function settle(draft: Draft, at: number) {
  for (const message of draft.messages) {
    if (message.role === "assistant" && message.streaming) {
      const mutable = draft.message(message.id)
      if (mutable) closeStreaming(draft, mutable, at)
    }
  }
}

function reduce(draft: Draft, event: OpenCodeEvent, sessionID: string) {
  if (!("data" in event) || !event.data || (event.data as { sessionID?: string }).sessionID !== sessionID)
    return
  const at = "created" in event && typeof event.created === "number" ? event.created : Date.now()
  switch (event.type) {
    case "session.inbox.enqueued": {
      const { item, inboxID } = event.data
      if (item.type === "user") {
        const payload = item.payload
        draft.append({
          id: inboxID,
          sessionID,
          role: "user",
          kind: "user",
          parts: (() => {
            const text = userText(payload.text, payload.metadata)
            return text ? [{ type: "text", text }] : []
          })(),
          attachments: userAttachments(payload.files, payload.metadata),
          created: at,
        })
      } else if (item.type === "synthetic") {
        draft.append({
          id: inboxID,
          sessionID,
          role: "system",
          kind: "synthetic",
          parts: item.payload.text ? [{ type: "text", text: item.payload.text }] : [],
          created: at,
        })
      }
      return
    }
    case "session.inbox.delivered":
      draft.moveToEnd(event.data.inboxID, at)
      return
    case "session.inbox.cancelled":
      draft.removeWhere((message) => message.id === event.data.inboxID)
      return
    case "session.step.started": {
      const { assistantMessageID: id, agent, model, started } = event.data
      const existing = draft.message(id)
      if (existing) {
        existing.agent = agent
        existing.model = model
        existing.error = undefined
        existing.completed = undefined
        existing.streaming = true
        return
      }
      const active = draft.activeAssistant()
      if (active) closeStreaming(draft, active, at)
      draft.append({
        id,
        sessionID,
        role: "assistant",
        kind: "assistant",
        parts: [],
        agent,
        model,
        created: started,
        streaming: true,
      })
      return
    }
    case "session.step.ended": {
      const message = draft.message(event.data.assistantMessageID)
      if (!message) return
      closeStreaming(draft, message, at)
      message.tokens = event.data.tokens
      message.cost = event.data.cost
      if (event.data.files?.length) message.changedFiles = [...event.data.files]
      return
    }
    case "session.step.failed": {
      const message = draft.message(event.data.assistantMessageID)
      if (!message) return
      closeStreaming(draft, message, at)
      message.error = event.data.error.message
      if (event.data.tokens) message.tokens = event.data.tokens
      if (event.data.cost !== undefined) message.cost = event.data.cost
      if (event.data.files?.length) message.changedFiles = [...event.data.files]
      return
    }
    case "session.text.started":
    case "session.reasoning.started": {
      const kind = event.type === "session.text.started" ? "text" : "reasoning"
      const { assistantMessageID: id, ordinal } = event.data
      const key = partKey(id, kind, ordinal)
      if (draft.parts.has(key)) return
      const message = draft.message(id)
      if (!message) return
      draft.addPart<TextPart | ReasoningPart>(
        message,
        key,
        kind === "text"
          ? { type: "text", text: "", streaming: true }
          : { type: "reasoning", text: "", streaming: true, time: { created: at } },
      )
      return
    }
    case "session.text.delta":
    case "session.reasoning.delta": {
      const kind = event.type === "session.text.delta" ? "text" : "reasoning"
      const { assistantMessageID: id, ordinal, delta } = event.data
      const key = partKey(id, kind, ordinal)
      const found = draft.findPart<TextPart | ReasoningPart>(id, key)
      if (found) {
        found.part.text += delta
        return
      }
      // Joined mid-stream (the start raced our load): open the part; `*.ended` restores the full text.
      const message = draft.message(id)
      if (message)
        draft.addPart<TextPart | ReasoningPart>(
          message,
          key,
          kind === "text"
            ? { type: "text", text: delta, streaming: true }
            : { type: "reasoning", text: delta, streaming: true, time: { created: at } },
        )
      return
    }
    case "session.text.ended":
    case "session.reasoning.ended": {
      const kind = event.type === "session.text.ended" ? "text" : "reasoning"
      const { assistantMessageID: id, ordinal, text } = event.data
      const key = partKey(id, kind, ordinal)
      const found = draft.findPart<TextPart | ReasoningPart>(id, key)
      const part =
        found?.part ??
        (() => {
          const message = draft.message(id)
          return message
            ? draft.addPart<TextPart | ReasoningPart>(message, key, { type: kind, text: "" } as
                TextPart | ReasoningPart)
            : undefined
        })()
      if (!part) return
      part.text = text
      part.streaming = false
      if (part.type === "reasoning") part.time = { created: part.time?.created ?? at, completed: at }
      return
    }
    case "session.tool.input.started": {
      const { assistantMessageID: id, id: toolID, name } = event.data
      const key = partKey(id, "tool", toolID)
      if (draft.parts.has(key)) return
      const message = draft.message(id)
      if (!message) return
      draft.addPart<ToolPart>(message, key, {
        type: "tool",
        id: toolID,
        name,
        status: "streaming",
        inputText: "",
        time: { created: at },
      })
      return
    }
    case "session.tool.input.delta": {
      const found = draft.findPart<ToolPart>(
        event.data.assistantMessageID,
        partKey(event.data.assistantMessageID, "tool", event.data.id),
      )
      if (found && found.part.status === "streaming")
        found.part.inputText = (found.part.inputText ?? "") + event.data.delta
      return
    }
    case "session.tool.input.ended": {
      const found = draft.findPart<ToolPart>(
        event.data.assistantMessageID,
        partKey(event.data.assistantMessageID, "tool", event.data.id),
      )
      if (!found || found.part.status !== "streaming") return
      found.part.inputText = event.data.text
      found.part.input = parseToolInput(event.data.text)
      return
    }
    case "session.tool.called": {
      const found = draft.findPart<ToolPart>(
        event.data.assistantMessageID,
        partKey(event.data.assistantMessageID, "tool", event.data.id),
      )
      if (!found) return
      found.part.status = "running"
      found.part.input = event.data.input
      return
    }
    case "session.tool.progress": {
      const found = draft.findPart<ToolPart>(
        event.data.assistantMessageID,
        partKey(event.data.assistantMessageID, "tool", event.data.id),
      )
      if (found && found.part.status === "running") found.part.metadata = event.data.metadata
      return
    }
    case "session.tool.success": {
      const found = draft.findPart<ToolPart>(
        event.data.assistantMessageID,
        partKey(event.data.assistantMessageID, "tool", event.data.id),
      )
      if (!found) return
      found.part.status = "completed"
      found.part.output = toolOutput(event.data.content)
      if (event.data.metadata) found.part.metadata = event.data.metadata
      found.part.time.completed = at
      return
    }
    case "session.tool.failed": {
      const found = draft.findPart<ToolPart>(
        event.data.assistantMessageID,
        partKey(event.data.assistantMessageID, "tool", event.data.id),
      )
      if (!found) return
      found.part.status = "error"
      found.part.error = event.data.error.message
      found.part.output = toolOutput(event.data.content)
      if (event.data.metadata) found.part.metadata = event.data.metadata
      found.part.time.completed = at
      return
    }
    case "session.execution.succeeded":
    case "session.execution.interrupted":
      settle(draft, at)
      return
    case "session.execution.failed": {
      settle(draft, at)
      const id = event.id.replace(/^evt_/, "msg_")
      draft.append({
        id,
        sessionID,
        role: "system",
        kind: "idle",
        parts: [],
        created: at,
        error: event.data.error.message,
      })
      return
    }
    case "session.status":
      if (event.data.status.type === "idle") settle(draft, at)
      return
    case "session.revert.committed": {
      const to = event.data.to
      draft.removeWhere((message) => message.id >= to)
      return
    }
    default:
      return
  }
}

/** Applies a batch of events to one session's projection. Returns `projection` itself when unchanged. */
export function applyEvents(
  projection: Projection,
  sessionID: string,
  events: readonly OpenCodeEvent[],
): Projection {
  const draft = new Draft(projection)
  for (const event of events) reduce(draft, event, sessionID)
  return draft.finish()
}

export function applyEvent(projection: Projection, sessionID: string, event: OpenCodeEvent): Projection {
  return applyEvents(projection, sessionID, [event])
}

/** Ends any streaming state (used after loading a session that is not running). */
export function settleProjection(projection: Projection, at = Date.now()): Projection {
  const draft = new Draft(projection)
  settle(draft, at)
  return draft.finish()
}

/** True when a tool call is still open (used to decide whether to refetch after execution ends). */
export function hasOpenTools(projection: Projection): boolean {
  return projection.messages.some(
    (message) =>
      message.role === "assistant" &&
      message.parts.some(
        (part) => part.type === "tool" && (part.status === "streaming" || part.status === "running"),
      ),
  )
}

/** Event types that change the message projection (others are ignored by the reducer). */
export const PROJECTION_EVENTS = new Set<string>([
  "session.inbox.enqueued",
  "session.inbox.delivered",
  "session.inbox.cancelled",
  "session.step.started",
  "session.step.ended",
  "session.step.failed",
  "session.text.started",
  "session.text.delta",
  "session.text.ended",
  "session.reasoning.started",
  "session.reasoning.delta",
  "session.reasoning.ended",
  "session.tool.input.started",
  "session.tool.input.delta",
  "session.tool.input.ended",
  "session.tool.called",
  "session.tool.progress",
  "session.tool.success",
  "session.tool.failed",
  "session.execution.succeeded",
  "session.execution.interrupted",
  "session.execution.failed",
  "session.status",
  "session.revert.committed",
])
