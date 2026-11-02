import { describe, expect, it, vi } from "vitest"
import { Limiter } from "@/lib/runtime/limiter"

function setup(max = 2) {
  const started: string[] = []
  const onChange = vi.fn()
  let limit = max
  const limiter = new Limiter({ max: () => limit, onChange })
  const send = (id: string, tag = id) => limiter.acquire(id, () => started.push(tag))
  return { limiter, started, send, onChange, setMax: (n: number) => (limit = n) }
}

describe("Limiter", () => {
  it("starts up to max sessions and queues the rest in order", () => {
    const { limiter, started, send } = setup(2)
    send("a")
    send("b")
    send("c")
    send("d")
    expect(started).toEqual(["a", "b"])
    expect(limiter.isQueued("c")).toBe(true)
    expect(limiter.queuedSessions()).toEqual(["c", "d"])
    limiter.release("a")
    expect(started).toEqual(["a", "b", "c"])
    limiter.release("b")
    expect(started).toEqual(["a", "b", "c", "d"])
    expect(limiter.queuedSessions()).toEqual([])
  })

  it("lets a session that holds a slot send more prompts immediately", () => {
    const { started, send } = setup(1)
    send("a", "a1")
    send("a", "a2")
    expect(started).toEqual(["a1", "a2"])
  })

  it("starts all queued prompts of a session when it gets a slot", () => {
    const { limiter, started, send } = setup(1)
    send("a")
    send("b", "b1")
    send("b", "b2")
    limiter.release("a")
    expect(started).toEqual(["a", "b1", "b2"])
  })

  it("cancels queued prompts of a session", () => {
    const { limiter, started, send } = setup(1)
    send("a")
    send("b")
    expect(limiter.cancel("b")).toBe(1)
    limiter.release("a")
    expect(started).toEqual(["a"])
  })

  it("ignores releases of sessions without a slot and pumps when max grows", () => {
    const { limiter, started, send, setMax } = setup(1)
    send("a")
    send("b")
    limiter.release("zzz")
    expect(started).toEqual(["a"])
    setMax(2)
    limiter.pump()
    expect(started).toEqual(["a", "b"])
  })

  it("treats invalid max values as 1", () => {
    const { started, send } = setup(0)
    send("a")
    send("b")
    expect(started).toEqual(["a"])
  })
})
