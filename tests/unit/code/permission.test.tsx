import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { PermissionCard } from "@/features/chat/PermissionCard"
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

const REQUEST = {
  id: "perm_test",
  sessionID: "ses_code_rate",
  action: "bash",
  resources: ["pnpm add express-rate-limit"],
  message: "Run pnpm add express-rate-limit",
}

function renderCard(shortcuts = true) {
  return render(
    <TooltipProvider>
      <PermissionCard request={REQUEST} variant="code" shortcuts={shortcuts} />
    </TooltipProvider>,
  )
}

describe("PermissionCard (code variant)", () => {
  beforeEach(() => {
    resetCode()
    vi.restoreAllMocks()
  })

  it("shows the command and the three decisions", () => {
    renderCard()
    expect(screen.getByLabelText("Resources")).toHaveTextContent("$ pnpm add express-rate-limit")
    for (const name of [/Allow once/, /Always/, /Deny/])
      expect(screen.getByRole("button", { name })).toBeEnabled()
  })

  it("allows once with ⌘⏎ (Ctrl+Enter off macOS)", async () => {
    const reply = vi.spyOn(mock, "replyPermission").mockResolvedValue()
    renderCard()
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true })
    await waitFor(() => expect(reply).toHaveBeenCalledWith("ses_code_rate", "perm_test", "once"))
  })

  it("denies with Esc", async () => {
    const reply = vi.spyOn(mock, "replyPermission").mockResolvedValue()
    renderCard()
    fireEvent.keyDown(window, { key: "Escape" })
    await waitFor(() => expect(reply).toHaveBeenCalledWith("ses_code_rate", "perm_test", "reject"))
  })

  it("ignores the keyboard when shortcuts are off", async () => {
    const reply = vi.spyOn(mock, "replyPermission").mockResolvedValue()
    renderCard(false)
    fireEvent.keyDown(window, { key: "Escape" })
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true })
    await act(async () => {})
    expect(reply).not.toHaveBeenCalled()
  })

  it("clicking Always replies with always", async () => {
    const reply = vi.spyOn(mock, "replyPermission").mockResolvedValue()
    renderCard()
    fireEvent.click(screen.getByRole("button", { name: /Always/ }))
    await waitFor(() => expect(reply).toHaveBeenCalledWith("ses_code_rate", "perm_test", "always"))
    expect(useCodeNav.getState().sessionID).toBeUndefined()
  })
})
