import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import CodeSurface from "@/features/code/CodeSurface"
import { useCodeNav } from "@/features/code/code-nav"
import { mock, resetCode } from "./setup"

vi.mock("@/lib/runtime", async () => {
  const { makeMockRuntime } = await import("@/lib/runtime/mock")
  return { runtime: makeMockRuntime({ latency: 1, persist: false }) }
})
vi.mock("@/lib/runtime/code", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/runtime/code")>()
  const { makeMockCodeRuntime } = await import("@/lib/runtime/mock/code")
  return { ...actual, codeRuntime: makeMockCodeRuntime() }
})
vi.mock("@/components/markdown/shiki", () => ({ highlightCode: async () => null }))

describe("CodeSurface keyboard", () => {
  beforeEach(() => {
    resetCode()
    vi.restoreAllMocks()
  })

  it("Esc answers a pending permission (Deny) instead of stopping the session", async () => {
    const interrupt = vi.spyOn(mock, "interrupt")
    const reply = vi.spyOn(mock, "replyPermission").mockResolvedValue()
    useCodeNav.setState({ sessionID: "ses_code_rate" })
    render(
      <TooltipProvider>
        <CodeSurface />
      </TooltipProvider>,
    )
    expect(await screen.findByLabelText("Permission requests")).toBeInTheDocument()
    fireEvent.keyDown(window, { key: "Escape" })
    await waitFor(() => expect(reply).toHaveBeenCalledWith("ses_code_rate", "perm_code_rate", "reject"))
    expect(interrupt).not.toHaveBeenCalled()
  })

  it("Esc interrupts even when the session looks idle locally (stale activity)", async () => {
    const interrupt = vi.spyOn(mock, "interrupt").mockResolvedValue()
    useCodeNav.setState({ sessionID: "ses_code_auth" })
    render(
      <TooltipProvider>
        <CodeSurface />
      </TooltipProvider>,
    )
    await screen.findByTestId("code-session")
    fireEvent.keyDown(window, { key: "Escape" })
    await waitFor(() => expect(interrupt).toHaveBeenCalledWith("ses_code_auth"))
  })

  it("an inline or closed role=dialog element does not swallow Esc", async () => {
    const interrupt = vi.spyOn(mock, "interrupt").mockResolvedValue()
    useCodeNav.setState({ sessionID: "ses_code_auth" })
    render(
      <TooltipProvider>
        <CodeSurface />
        <div role="dialog" aria-label="Question" />
        <div role="menu" data-state="closed" />
      </TooltipProvider>,
    )
    await screen.findByTestId("code-session")
    fireEvent.keyDown(window, { key: "Escape" })
    await waitFor(() => expect(interrupt).toHaveBeenCalledWith("ses_code_auth"))
  })

  it("an open overlay still takes Esc instead of interrupting", async () => {
    const interrupt = vi.spyOn(mock, "interrupt").mockResolvedValue()
    useCodeNav.setState({ sessionID: "ses_code_auth" })
    render(
      <TooltipProvider>
        <CodeSurface />
        <div role="dialog" data-state="open" aria-label="Settings" />
      </TooltipProvider>,
    )
    await screen.findByTestId("code-session")
    fireEvent.keyDown(window, { key: "Escape" })
    await new Promise((r) => setTimeout(r, 20))
    expect(interrupt).not.toHaveBeenCalled()
  })

  it("⌘⇧D toggles the diff pane", async () => {
    useCodeNav.setState({ sessionID: "ses_code_auth" })
    render(
      <TooltipProvider>
        <CodeSurface />
      </TooltipProvider>,
    )
    await screen.findByTestId("code-session")
    await act(async () => {
      fireEvent.keyDown(window, { key: "D", code: "KeyD", ctrlKey: true, shiftKey: true })
    })
    expect(useCodeNav.getState()).toMatchObject({ paneOpen: true, paneTab: "diff" })
    expect(await screen.findByTestId("diff-pane")).toBeInTheDocument()
  })
})
