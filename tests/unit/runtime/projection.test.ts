import { beforeEach, describe, expect, it } from "vitest"
import type { ReasoningPart, TextPart, ToolPart } from "@/lib/runtime/contracts"
import { mapMessages } from "@/lib/runtime/map"
import {
  applyEvent,
  applyEvents,
  emptyProjection,
  hasOpenTools,
  projectionFromList,
  settleProjection,
  type Projection,
} from "@/lib/runtime/projection"
import {
  A1,
  A2,
  SID,
  TOOL,
  USER,
  ev,
  fullTurn,
  persistedTurn,
  resetSeq,
  stepStarted,
  text,
  toolCall,
  userEnqueued,
} from "./fixtures"

const run = (events: Parameters<typeof applyEvents>[2], base: Projection = emptyProjection()) =>
  applyEvents(base, SID, events)

beforeEach(resetSeq)

describe("live projection", () => {
  it("projects a full captured turn", () => {
    const p = run(fullTurn())
    expect(p.messages.map((m) => [m.role, m.id])).toEqual([
      ["user", USER],
      ["assistant", A1],
      ["assistant", A2],
    ])
    const [user, a1, a2] = p.messages
    expect(user!.parts).toEqual([{ type: "text", text: "Reply with exactly: hello world." }])
    expect(a1!.parts.map((x) => x.type)).toEqual(["reasoning", "text", "tool"])
    const reasoning = a1!.parts[0] as ReasoningPart
    expect(reasoning.text).toBe("Simple request.")
    expect(reasoning.streaming).toBe(false)
    expect((a1!.parts[1] as TextPart).text).toBe("hello world")
    const tool = a1!.parts[2] as ToolPart
    expect(tool).toMatchObject({
      id: TOOL,
      name: "write",
      status: "completed",
      input: { path: "out.txt", content: "hi" },
      output: "Created file successfully: out.txt",
    })
    expect(tool.time.completed).toBeTypeOf("number")
    expect(a1!.changedFiles).toEqual(["out.txt"])
    expect(a1!.tokens?.output).toBe(20)
    expect(a1!.streaming).toBeUndefined()
    expect((a2!.parts[0] as TextPart).text).toBe("Done — created `out.txt`.")
    expect(a2!.streaming).toBeUndefined()
    expect(hasOpenTools(p)).toBe(false)
  })

  it("matches the persisted mapping of the same turn", () => {
    const live = run(fullTurn()).messages
    const loaded = mapMessages(persistedTurn(), SID)
    const shape = (list: typeof live) =>
      list.map((m) => ({
        id: m.id,
        role: m.role,
        parts: m.parts.map((p) => (p.type === "tool" ? [p.type, p.status, p.output] : [p.type, p.text])),
      }))
    expect(shape(live)).toEqual(shape(loaded))
  })

  it("streams text with deltas and marks parts streaming until ended", () => {
    const events = [userEnqueued(), stepStarted(A1), ...text(A1, 0, ["a", "b", "c"]).slice(0, 3)]
    const p = run(events)
    const part = p.messages[1]!.parts[0] as TextPart
    expect(part).toEqual({ type: "text", text: "ab", streaming: true })
    expect(p.messages[1]!.streaming).toBe(true)
  })

  it("addresses text and reasoning by ordinal per kind", () => {
    const p = run([
      stepStarted(A1),
      ...text(A1, 0, ["first"]),
      ev("session.text.started", { sessionID: SID, assistantMessageID: A1, ordinal: 1 }),
      ev("session.text.delta", { sessionID: SID, assistantMessageID: A1, ordinal: 1, delta: "second" }),
      // A late delta for ordinal 0 must not leak into ordinal 1.
      ev("session.text.delta", { sessionID: SID, assistantMessageID: A1, ordinal: 0, delta: "!" }),
    ])
    expect(p.messages[0]!.parts.map((x) => (x as TextPart).text)).toEqual(["first!", "second"])
  })

  it("applies 10k deltas in one batch quickly and keeps untouched messages by reference", () => {
    const base = run([
      userEnqueued(),
      stepStarted(A1),
      ev("session.text.started", { sessionID: SID, assistantMessageID: A1, ordinal: 0 }),
    ])
    const deltas = Array.from({ length: 10_000 }, () =>
      ev("session.text.delta", { sessionID: SID, assistantMessageID: A1, ordinal: 0, delta: "x" }),
    )
    const t0 = performance.now()
    const next = applyEvents(base, SID, deltas)
    const elapsed = performance.now() - t0
    expect((next.messages[1]!.parts[0] as TextPart).text.length).toBe(10_000)
    expect(next.messages[0]).toBe(base.messages[0])
    expect(next.messages).not.toBe(base.messages)
    expect(elapsed).toBeLessThan(250)
  })

  it("never mutates the previous projection's messages", () => {
    const base = run([
      stepStarted(A1),
      ev("session.text.started", { sessionID: SID, assistantMessageID: A1, ordinal: 0 }),
    ])
    const before = JSON.stringify(base.messages)
    applyEvent(
      base,
      SID,
      ev("session.text.delta", { sessionID: SID, assistantMessageID: A1, ordinal: 0, delta: "zzz" }),
    )
    expect(JSON.stringify(base.messages)).toBe(before)
  })

  it("is idempotent when replaying events over a loaded projection", () => {
    const loaded = projectionFromList(persistedTurn(), SID)
    const replay = [
      userEnqueued(),
      stepStarted(A1),
      ...text(A1, 0, ["hello world"]).filter((e) => e.type !== "session.text.delta"),
      ...toolCall(
        A1,
        TOOL,
        "write",
        { path: "out.txt", content: "hi" },
        "Created file successfully: out.txt",
      ).slice(0, 1),
    ]
    const p = applyEvents(loaded, SID, replay)
    expect(p.messages.map((m) => m.id)).toEqual(loaded.messages.map((m) => m.id))
    expect(p.messages[1]!.parts.length).toBe(3)
  })

  it("opens a part for a delta whose start was missed, and the end restores the full text", () => {
    const p = run([
      stepStarted(A1),
      ev("session.text.delta", { sessionID: SID, assistantMessageID: A1, ordinal: 0, delta: "lo" }),
    ])
    expect((p.messages[0]!.parts[0] as TextPart).text).toBe("lo")
    const done = applyEvent(
      p,
      SID,
      ev("session.text.ended", { sessionID: SID, assistantMessageID: A1, ordinal: 0, text: "hello" }),
    )
    expect(done.messages[0]!.parts[0]).toEqual({ type: "text", text: "hello", streaming: false })
  })

  it("records tool failures and step failures", () => {
    const p = run([
      stepStarted(A1),
      ev("session.tool.input.started", { sessionID: SID, assistantMessageID: A1, id: "t1", name: "bash" }),
      ev("session.tool.called", {
        sessionID: SID,
        assistantMessageID: A1,
        id: "t1",
        input: { command: "false" },
        executed: true,
      }),
      ev("session.tool.progress", {
        sessionID: SID,
        assistantMessageID: A1,
        id: "t1",
        metadata: { output: "..." },
      }),
      ev("session.tool.failed", {
        sessionID: SID,
        assistantMessageID: A1,
        id: "t1",
        error: { type: "tool", message: "exit 1" },
        executed: true,
      }),
      ev("session.step.failed", {
        sessionID: SID,
        assistantMessageID: A1,
        error: { type: "provider", message: "rate limited" },
      }),
    ])
    const tool = p.messages[0]!.parts[0] as ToolPart
    expect(tool).toMatchObject({ status: "error", error: "exit 1", input: { command: "false" } })
    expect(p.messages[0]!.error).toBe("rate limited")
    expect(p.messages[0]!.streaming).toBeUndefined()
  })

  it("keeps the streaming tool input text and parses it when complete", () => {
    const events = toolCall(A1, "t2", "artifact_create", { title: "Chart" }, "ok")
    const partial = run([stepStarted(A1), ...events.slice(0, 2)])
    const tool = partial.messages[0]!.parts[0] as ToolPart
    expect(tool.status).toBe("streaming")
    expect(tool.inputText).toBe('{"tit')
    expect(tool.input).toBeUndefined()
    const ended = run([stepStarted(A1), ...events.slice(0, 4)])
    expect((ended.messages[0]!.parts[0] as ToolPart).input).toEqual({ title: "Chart" })
    expect(hasOpenTools(ended)).toBe(true)
  })

  it("closes the previous assistant message when a new step starts", () => {
    const p = run([stepStarted(A1), ...text(A1, 0, ["x"]).slice(0, 2), stepStarted(A2, 2)])
    expect(p.messages[0]!.streaming).toBeUndefined()
    expect((p.messages[0]!.parts[0] as TextPart).streaming).toBe(false)
    expect(p.messages[1]!.streaming).toBe(true)
  })

  it("re-times delivered inbox messages and removes cancelled ones", () => {
    const p = run([
      userEnqueued(USER, "first"),
      stepStarted(A1),
      userEnqueued("msg_zzz", "queued"),
      ev("session.inbox.delivered", { sessionID: SID, inboxID: USER }, 5),
    ])
    expect(p.messages.map((m) => m.id)).toEqual([A1, "msg_zzz", USER])
    expect(p.messages[2]!.created).toBe(5)
    const cancelled = applyEvent(
      p,
      SID,
      ev("session.inbox.cancelled", { sessionID: SID, inboxID: "msg_zzz" }),
    )
    expect(cancelled.messages.map((m) => m.id)).toEqual([A1, USER])
    expect(cancelled.index.get(USER)).toBe(1)
  })

  it("drops every message at or after a committed revert boundary", () => {
    const p = run(fullTurn())
    const reverted = applyEvent(p, SID, ev("session.revert.committed", { sessionID: SID, to: A1 }))
    expect(reverted.messages.map((m) => m.id)).toEqual([USER])
    expect(reverted.index.has(A1)).toBe(false)
  })

  it("adds an error row on execution failure and settles streaming parts", () => {
    const p = run([
      stepStarted(A1),
      ...text(A1, 0, ["par"]).slice(0, 2),
      ev("session.execution.failed", { sessionID: SID, error: { type: "provider", message: "boom" } }),
    ])
    expect(p.messages[0]!.streaming).toBeUndefined()
    expect(p.messages.at(-1)).toMatchObject({ role: "system", kind: "idle", error: "boom" })
  })

  it("ignores events of other sessions and unrelated types", () => {
    const base = run([userEnqueued()])
    const other = { ...stepStarted(A1), data: { ...stepStarted(A1).data, sessionID: "ses_other" } }
    expect(applyEvent(base, SID, other)).toBe(base)
    expect(applyEvent(base, SID, ev("session.renamed", { sessionID: SID, title: "x" }))).toBe(base)
  })

  it("shows the user's own text and attachments from metadata.opal", () => {
    const p = run([
      userEnqueued(USER, "Summarize\n\n<user_attachments>\n- uploads/a.csv\n</user_attachments>", {
        opal: {
          text: "Summarize",
          attachments: [{ name: "a.csv", mime: "text/csv", uri: "file:///x/uploads/a.csv", size: 3 }],
        },
      }),
    ])
    expect(p.messages[0]!.parts).toEqual([{ type: "text", text: "Summarize" }])
    expect(p.messages[0]!.attachments).toEqual([
      { name: "a.csv", mime: "text/csv", uri: "file:///x/uploads/a.csv", size: 3 },
    ])
  })

  it("settles a loaded projection whose session is idle", () => {
    const list = persistedTurn()
    const a = list[2] as Extract<(typeof list)[number], { type: "assistant" }>
    a.time = { created: a.time.created }
    const loaded = projectionFromList(list, SID)
    expect(loaded.messages[2]!.streaming).toBe(true)
    expect(settleProjection(loaded).messages[2]!.streaming).toBeUndefined()
  })
})

describe("persisted mapping", () => {
  it("hides markers and maps idle failures", () => {
    const rows = mapMessages(
      [
        ...persistedTurn(),
        { id: "msg_2", time: { created: 1 }, type: "model-switched", model: { id: "m", providerID: "p" } },
        { id: "msg_3", time: { created: 2 }, type: "idle", outcome: "interrupted" },
        { id: "msg_4", time: { created: 3 }, type: "system", text: "instructions" },
      ] as Parameters<typeof mapMessages>[0],
      SID,
    )
    expect(rows.map((r) => r.kind)).toEqual(["user", "assistant", "assistant", "idle"])
    expect(rows.at(-1)!.error).toBe("Interrupted")
  })

  it("maps inline and uri file attachments", () => {
    const [row] = mapMessages(
      [
        {
          id: USER,
          type: "user",
          text: "look",
          time: { created: 1 },
          files: [
            { data: "aGVsbG8=", mime: "image/png", source: { type: "inline" }, name: "a.png" },
            {
              data: "aGk=",
              mime: "application/pdf",
              source: { type: "uri", uri: "file:///s/uploads/b.pdf" },
              name: "b.pdf",
            },
          ],
        },
      ] as Parameters<typeof mapMessages>[0],
      SID,
    )
    expect(row!.attachments).toEqual([
      { name: "a.png", mime: "image/png", uri: "data:image/png;base64,aGVsbG8=", size: 5 },
      { name: "b.pdf", mime: "application/pdf", uri: "file:///s/uploads/b.pdf", size: 2 },
    ])
  })
})
