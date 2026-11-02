import { afterEach, describe, expect, it, vi } from "vitest"
import { makeMockRuntime } from "@/lib/runtime/mock"
import { scriptFor } from "@/lib/runtime/mock/replies"

const PROMPT = "Show me your inline chat features"

/** Top-level fenced blocks: `{ lang, info, body }` for every fence that is closed. */
function fences(text: string) {
  return [...text.matchAll(/^```(\w+)([^\n]*)\n([\s\S]*?)\n```$/gm)].map((m) => ({
    lang: m[1],
    info: m[2].trim(),
    body: m[3],
  }))
}

function tourText() {
  return scriptFor(PROMPT, "artifact")
    .map((s) => (s.kind === "text" ? s.text : ""))
    .join("")
}

describe("mock inline-widgets tour", () => {
  afterEach(() => vi.useRealTimers())

  it("starts with a reasoning step and is chosen before the artifact script", () => {
    const steps = scriptFor(PROMPT, "artifact")
    expect(steps[0].kind).toBe("reasoning")
    expect(steps.some((s) => s.kind === "tool")).toBe(false)
    // "chart" alone still goes to the artifact script.
    expect(scriptFor("make a chart", "artifact").some((s) => s.kind === "tool")).toBe(true)
    expect(scriptFor("an inline chart please", "artifact").some((s) => s.kind === "tool")).toBe(false)
  })

  it("contains closed chart, widget, mermaid and svg fences", () => {
    const text = tourText()
    const blocks = fences(text)
    expect(blocks.map((b) => b.lang)).toEqual(["chart", "widget", "widget", "mermaid", "svg"])
    expect((text.match(/^```/gm) ?? []).length).toBe(blocks.length * 2)
    for (const h of [
      "## 1. Interactive chart",
      "## 2. Interactive calculator",
      "## 3. Decision tree",
      "## 4. Architecture",
      "## 5. Logo",
    ])
      expect(text).toContain(h)

    const [simulator, tree] = blocks.filter((b) => b.lang === "widget")
    expect(simulator.info).toBe('title="Rental fleet simulator"')
    expect(simulator.body).toMatch(/^<!doctype html>/)
    expect((simulator.body.match(/<input [^>]*type="range"/g) ?? []).length).toBe(4)
    expect(simulator.body).toContain("var(--bg-elevated)")
    expect(simulator.body).toContain("window.opal.sendPrompt")
    expect(simulator.body).not.toContain("100vh")
    expect((tree.body.match(/<input [^>]*type="radio"/g) ?? []).length).toBe(6)
    expect(new Set([...tree.body.matchAll(/name="(\w+)"/g)].map((m) => m[1]))).toEqual(
      new Set(["freq", "size"]),
    )

    expect(blocks.find((b) => b.lang === "mermaid")?.body).toMatch(/^flowchart /)
    expect(blocks.find((b) => b.lang === "svg")?.body).toMatch(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox=/,
    )
  })

  it("ships a valid chart spec with three dataset tabs", () => {
    const chart = fences(tourText()).find((b) => b.lang === "chart")!
    const spec = JSON.parse(chart.body)
    expect(spec.type).toBe("line")
    expect(spec.datasets).toHaveLength(3)
    expect(spec.datasets.map((d: { label: string }) => d.label)).toEqual(["Revenue", "Orders", "Conversion"])
    expect(spec.datasets.map((d: { format: string }) => d.format)).toEqual([
      "currency:EUR",
      "number",
      "percent",
    ])
    for (const d of spec.datasets) for (const s of d.series) expect(s.data).toHaveLength(spec.x.length)
  })

  it("streams the fences progressively without splitting a fence marker", async () => {
    vi.useFakeTimers()
    const rt = makeMockRuntime({ latency: 1, persist: false, empty: true })
    const session = await rt.createSession({ surface: "chat", mode: "artifact" })
    const snapshots: string[] = []
    const unsubscribe = rt.store.subscribe((st) => {
      const last = st.messages[session.id]?.at(-1)
      if (last?.role !== "assistant") return
      const text = last.parts.map((p) => (p.type === "text" ? p.text : "")).join("")
      if (text && text !== snapshots.at(-1)) snapshots.push(text)
    })
    await rt.sendPrompt(session.id, { text: PROMPT })
    await vi.runAllTimersAsync()
    unsubscribe()

    const final = rt.store.getState().messages[session.id].at(-1)!
    expect(final.parts[0].type).toBe("reasoning")
    expect(snapshots.at(-1)).toBe(tourText())
    // Every intermediate state only ever contains whole ``` markers.
    for (const s of snapshots)
      expect(s.match(/`+/g)?.every((run) => run.length === 3 || run.length === 1) ?? true).toBe(true)
    // The chart fence is visible (open) before it closes, i.e. it really streams.
    expect(snapshots.some((s) => s.includes("```chart") && fences(s).length === 0)).toBe(true)
    expect(snapshots.length).toBeGreaterThan(50)
  })
})
