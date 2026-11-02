/**
 * Event fixtures for the projection tests. Shapes follow packages/schema/src/session-event.ts
 * (v2.2.5) and are type-checked against the generated client types via EventOf<T>["data"]; the
 * sequence mirrors a real stream captured from `opencode serve` (reasoning → text → tool call,
 * then a second step with the final answer).
 */
import type { EventOf, OpenCodeEvent, SessionMessage } from "@/lib/opencode/types"

export const SID = "ses_e67a1d9b5ffe78GUw17OPKnCmC"
export const USER = "msg_1985e26a1001WrM6HhoLcJ5jgs"
export const A1 = "msg_1985e26a8001hkvJSLb9cOkSxZ"
export const A2 = "msg_1985e2cfa001CJSfE5OEpF6ZGL"
export const TOOL = "chatcmpl-tool-856a3a721d69bdd7"
export const MODEL = { id: "glm-5.3-flash-free", providerID: "opencode", variant: "default" }
const TOKENS = { input: 5833, output: 20, reasoning: 17, cache: { read: 0, write: 0 } }

let seq = 0
export function resetSeq() {
  seq = 0
}

type EventType = OpenCodeEvent["type"]

export function ev<T extends EventType>(
  type: T,
  data: EventOf<T>["data"],
  created = 1_793_557_669_000 + seq,
): EventOf<T> {
  seq++
  return {
    id: `evt_${String(seq).padStart(6, "0")}fixture`,
    created,
    type,
    data,
    durable: { aggregateID: SID, seq, version: 1 },
  } as unknown as EventOf<T>
}

export function userEnqueued(
  id = USER,
  text = "Reply with exactly: hello world.",
  metadata?: Record<string, unknown>,
) {
  return ev("session.inbox.enqueued", {
    sessionID: SID,
    inboxID: id,
    item: { type: "user", payload: { text, ...(metadata ? { metadata } : {}) }, delivery: "steer" },
  })
}

export function stepStarted(assistantMessageID: string, started = 1_793_557_669_546) {
  return ev("session.step.started", {
    sessionID: SID,
    agent: "build",
    model: MODEL,
    assistantMessageID,
    started,
  })
}

export function stepEnded(
  assistantMessageID: string,
  finish: "stop" | "tool-calls" = "stop",
  files?: string[],
) {
  return ev("session.step.ended", {
    sessionID: SID,
    assistantMessageID,
    finish,
    rawFinish: finish === "stop" ? "stop" : "tool_calls",
    tokens: TOKENS,
    cost: 0,
    ...(files ? { files } : {}),
  })
}

export function text(assistantMessageID: string, ordinal: number, chunks: string[]): OpenCodeEvent[] {
  return [
    ev("session.text.started", { sessionID: SID, assistantMessageID, ordinal }),
    ...chunks.map((delta) =>
      ev("session.text.delta", { sessionID: SID, assistantMessageID, ordinal, delta }),
    ),
    ev("session.text.ended", { sessionID: SID, assistantMessageID, ordinal, text: chunks.join("") }),
  ]
}

export function reasoning(assistantMessageID: string, ordinal: number, chunks: string[]): OpenCodeEvent[] {
  return [
    ev("session.reasoning.started", {
      sessionID: SID,
      assistantMessageID,
      ordinal,
      native: { reasoningField: "reasoning_content" },
    }),
    ...chunks.map((delta) =>
      ev("session.reasoning.delta", { sessionID: SID, assistantMessageID, ordinal, delta }),
    ),
    ev("session.reasoning.ended", { sessionID: SID, assistantMessageID, ordinal, text: chunks.join("") }),
  ]
}

export function toolCall(
  assistantMessageID: string,
  id: string,
  name: string,
  input: Record<string, unknown>,
  result: string,
): OpenCodeEvent[] {
  const json = JSON.stringify(input)
  return [
    ev("session.tool.input.started", { sessionID: SID, assistantMessageID, id, name }),
    ev("session.tool.input.delta", { sessionID: SID, assistantMessageID, id, delta: json.slice(0, 5) }),
    ev("session.tool.input.delta", { sessionID: SID, assistantMessageID, id, delta: json.slice(5) }),
    ev("session.tool.input.ended", { sessionID: SID, assistantMessageID, id, text: json }),
    ev("session.tool.called", { sessionID: SID, assistantMessageID, id, input, executed: false }),
    ev("session.tool.success", {
      sessionID: SID,
      assistantMessageID,
      id,
      content: [{ type: "text", text: result }],
      metadata: { truncated: false },
      executed: false,
    }),
  ]
}

/** The full captured turn: user → step 1 (reasoning, text, write tool) → step 2 (answer) → done. */
export function fullTurn(): OpenCodeEvent[] {
  return [
    userEnqueued(),
    ev("session.execution.started", { sessionID: SID }),
    ev("session.inbox.delivered", { sessionID: SID, inboxID: USER }),
    stepStarted(A1),
    ...reasoning(A1, 0, ["Simple ", "request."]),
    ...text(A1, 0, ["hello", " world"]),
    ...toolCall(A1, TOOL, "write", { path: "out.txt", content: "hi" }, "Created file successfully: out.txt"),
    stepEnded(A1, "tool-calls", ["out.txt"]),
    stepStarted(A2, 1_793_557_671_164),
    ...text(A2, 0, ["Done — created ", "`out.txt`."]),
    stepEnded(A2),
    ev("session.execution.succeeded", { sessionID: SID }),
  ]
}

/** Persisted `message.list` rows for the same turn (as returned by the server). */
export function persistedTurn(): SessionMessage[] {
  return [
    {
      id: USER,
      time: { created: 1_793_557_669_542 },
      text: "Reply with exactly: hello world.",
      type: "user",
    },
    {
      id: A1,
      time: { created: 1_793_557_669_546, streamed: 1_793_557_671_153, completed: 1_793_557_671_158 },
      type: "assistant",
      agent: "build",
      model: MODEL,
      content: [
        {
          type: "reasoning",
          text: "Simple request.",
          time: { created: 1_793_557_670_740, completed: 1_793_557_671_149 },
        },
        { type: "text", text: "hello world" },
        {
          type: "tool",
          id: TOOL,
          name: "write",
          executed: false,
          state: {
            status: "completed",
            input: { path: "out.txt", content: "hi" },
            content: [{ type: "text", text: "Created file successfully: out.txt" }],
            metadata: { truncated: false },
          },
          time: { created: 1_793_557_671_129, ran: 1_793_557_671_151, completed: 1_793_557_671_157 },
        },
      ],
      finish: "tool-calls",
      cost: 0,
      tokens: TOKENS,
    },
    {
      id: A2,
      time: { created: 1_793_557_671_164, completed: 1_793_557_672_102 },
      type: "assistant",
      agent: "build",
      model: MODEL,
      content: [{ type: "text", text: "Done — created `out.txt`." }],
      finish: "stop",
      cost: 0,
      tokens: TOKENS,
    },
    {
      id: "msg_1985e30a8001lIWDwmtT9VzWH1",
      time: { created: 1_793_557_672_104 },
      type: "idle",
      outcome: "succeeded",
    },
  ] as SessionMessage[]
}
