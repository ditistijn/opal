import { act, render } from "@testing-library/react"
import { useRef } from "react"
import { describe, expect, it, vi } from "vitest"
import { parseArtifactMessage, useArtifactErrors, type UseArtifactErrorsOptions } from "@/lib/artifacts"

describe("parseArtifactMessage", () => {
  it("accepts the documented messages", () => {
    expect(parseArtifactMessage({ type: "opal:ready" })).toEqual({ type: "opal:ready" })
    expect(parseArtifactMessage({ type: "opal:rendered", kind: "react" })).toEqual({
      type: "opal:rendered",
      kind: "react",
    })
    expect(
      parseArtifactMessage({ type: "opal:error", message: "boom", stack: "s", phase: "runtime" }),
    ).toEqual({
      type: "opal:error",
      message: "boom",
      stack: "s",
      phase: "runtime",
    })
    expect(parseArtifactMessage({ type: "opal:open-url", url: "https://x.y" })).toEqual({
      type: "opal:open-url",
      url: "https://x.y",
    })
  })
  it("rejects or sanitizes anything else", () => {
    expect(parseArtifactMessage(null)).toBeUndefined()
    expect(parseArtifactMessage("opal:error")).toBeUndefined()
    expect(parseArtifactMessage({ type: "opal:files", files: {} })).toBeUndefined()
    expect(parseArtifactMessage({ type: "opal:open-url", url: 5 })).toBeUndefined()
    expect(parseArtifactMessage({ type: "opal:error", message: 42 })).toMatchObject({
      message: "Unknown error",
    })
    const long = parseArtifactMessage({ type: "opal:error", message: "x".repeat(10_000) })
    expect(long && long.type === "opal:error" && long.message.length).toBe(4000)
  })
})

function Harness(props: {
  opts: Omit<UseArtifactErrorsOptions, "loadKey">
  onStatus(s: unknown): void
  loadKey?: string
}) {
  const ref = useRef<HTMLIFrameElement>(null)
  const { status } = useArtifactErrors(ref, { loadKey: props.loadKey ?? "k1", ...props.opts })
  props.onStatus(status)
  return <iframe ref={ref} title="t" />
}

function post(data: unknown, source: Window | null) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source }))
  })
}

describe("useArtifactErrors", () => {
  it("tracks render status from the iframe only", () => {
    let status: unknown
    const { container } = render(<Harness opts={{}} onStatus={(s) => (status = s)} />)
    const win = container.querySelector("iframe")!.contentWindow!
    expect(status).toEqual({ state: "loading" })
    post({ type: "opal:error", message: "nope" }, window) // wrong source → ignored
    expect(status).toEqual({ state: "loading" })
    post({ type: "opal:rendered" }, win)
    expect(status).toEqual({ state: "rendered" })
    post({ type: "opal:error", message: "boom", phase: "runtime" }, win)
    expect(status).toEqual({ state: "error", error: { message: "boom", stack: undefined, phase: "runtime" } })
    post({ type: "opal:rendered" }, win) // a later render signal does not hide the error
    expect(status).toMatchObject({ state: "error" })
  })

  it("answers opal:ready with the files and forwards link requests", async () => {
    const provideFiles = vi.fn(async () => ({ id: "art_x", entry: "a.md", files: { "a.md": "# hi" } }))
    const onOpenURL = vi.fn()
    const { container } = render(<Harness opts={{ provideFiles, onOpenURL }} onStatus={() => {}} />)
    const win = container.querySelector("iframe")!.contentWindow!
    const sent = vi.spyOn(win, "postMessage")
    post({ type: "opal:ready" }, win)
    await vi.waitFor(() => expect(sent).toHaveBeenCalled())
    expect(sent.mock.calls[0][0]).toEqual({
      type: "opal:files",
      id: "art_x",
      entry: "a.md",
      files: { "a.md": "# hi" },
    })
    post({ type: "opal:open-url", url: "https://example.com" }, win)
    expect(onOpenURL).toHaveBeenCalledWith("https://example.com")
  })

  it("flags slow loads after the timeout", () => {
    vi.useFakeTimers()
    let status: unknown
    render(<Harness opts={{ timeoutMs: 1000 }} onStatus={(s) => (status = s)} />)
    act(() => {
      vi.advanceTimersByTime(1001)
    })
    expect(status).toEqual({ state: "slow" })
    vi.useRealTimers()
  })
})
