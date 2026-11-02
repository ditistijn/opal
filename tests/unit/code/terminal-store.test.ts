import { beforeEach, describe, expect, it, vi } from "vitest"
import { useTerminals } from "@/features/code/terminal-store"
import { codeRuntime } from "@/lib/runtime/code"
import { ACME, resetCode } from "./setup"

vi.mock("@/lib/runtime", async () => {
  const { makeMockRuntime } = await import("@/lib/runtime/mock")
  return { runtime: makeMockRuntime({ latency: 1, persist: false }) }
})
vi.mock("@/lib/runtime/code", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/runtime/code")>()
  const { makeMockCodeRuntime } = await import("@/lib/runtime/mock/code")
  return { ...actual, codeRuntime: makeMockCodeRuntime() }
})

describe("terminal store", () => {
  beforeEach(() => {
    resetCode()
    vi.restoreAllMocks()
  })

  it("opens a fresh terminal when nothing is running in the directory", async () => {
    const create = vi.spyOn(codeRuntime.pty, "create")
    await useTerminals.getState().ensure("s1", "/nowhere")
    expect(create).toHaveBeenCalledWith({ directory: "/nowhere", title: "Terminal 1" })
    expect(useTerminals.getState().tabs.s1).toHaveLength(1)
  })

  it("re-attaches running PTYs after a reload instead of leaking new ones", async () => {
    const a = await codeRuntime.pty.create({ directory: ACME, title: "Terminal 1" })
    const b = await codeRuntime.pty.create({ directory: ACME, title: "Terminal 2" })
    const create = vi.spyOn(codeRuntime.pty, "create")
    await useTerminals.getState().ensure("s1", ACME)
    expect(create).not.toHaveBeenCalled()
    const tabs = useTerminals.getState().tabs.s1
    expect(tabs.map((t) => [t.title, t.handle?.id])).toEqual([
      ["Terminal 1", a.id],
      ["Terminal 2", b.id],
    ])
    expect(useTerminals.getState().active.s1).toBe(tabs[1].key)
    // A second session on the same checkout does not steal the first session's PTYs.
    await useTerminals.getState().ensure("s2", ACME)
    expect(create).toHaveBeenCalledOnce()
    // New tabs pick the first free title; closing removes the PTY.
    const close = vi.spyOn(codeRuntime.pty, "close")
    useTerminals.getState().closeTab("s1", tabs[0].key)
    expect(close).toHaveBeenCalledWith(a)
    await useTerminals.getState().addTab("s1", ACME)
    expect(useTerminals.getState().tabs.s1.map((t) => t.title)).toEqual(["Terminal 2", "Terminal 1"])
  })
})
