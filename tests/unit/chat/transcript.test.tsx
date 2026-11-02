import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { turnText, turnUsage, usageLabel } from "@/features/chat/AssistantMessage"
import { MessageList, transcriptBlocks } from "@/features/chat/MessageList"
import type { ChatMessage } from "@/lib/runtime"
import { mock, resetUI } from "./setup-mock"

vi.mock("@/lib/runtime", async () => {
  const { makeMockRuntime } = await import("@/lib/runtime/mock")
  return { runtime: makeMockRuntime({ latency: 1, persist: false }) }
})
vi.mock("@/components/markdown/shiki", () => ({ highlightCode: async () => null }))

let n = 0
function msg(role: "user" | "assistant", text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  n++
  return {
    id: `msg_${n}`,
    sessionID: "ses_rust",
    role,
    kind: role,
    parts: [{ type: "text", text }],
    created: n,
    ...extra,
  }
}
const toolStep = (name: string) =>
  msg("assistant", "", {
    parts: [
      {
        type: "tool",
        id: `t_${name}_${n}`,
        name: "bash",
        status: "completed",
        input: { command: name },
        output: "ok",
        time: { created: 0, completed: 1 },
      },
    ],
    tokens: { input: 1000, output: 100 },
    cost: 0.01,
  })

describe("transcript turns", () => {
  beforeEach(resetUI)

  it("groups consecutive assistant steps into one turn", () => {
    const list = [
      msg("user", "hi"),
      toolStep("a"),
      toolStep("b"),
      msg("assistant", "done"),
      msg("user", "again"),
    ]
    const blocks = transcriptBlocks(list)
    expect(blocks.map((b) => (b.kind === "turn" ? `turn:${b.messages.length}` : "user"))).toEqual([
      "user",
      "turn:3",
      "user",
    ])
  })

  it("sums usage and joins text across steps", () => {
    const steps = [
      toolStep("a"),
      msg("assistant", "one"),
      msg("assistant", "two", { tokens: { input: 5, output: 5 } }),
    ]
    expect(turnUsage(steps)).toEqual({ tokens: { input: 1005, output: 105 }, cost: 0.01 })
    expect(usageLabel(turnUsage(steps))).toBe("1.0k in · 105 out · $0.01")
    expect(turnText(steps)).toBe("one\n\ntwo")
  })

  it("renders one footer per turn, at the end, with copy and retry for the last turn", async () => {
    const regenerate = vi.spyOn(mock, "regenerate").mockResolvedValue()
    const user = userEvent.setup()
    const list = [
      msg("user", "first"),
      toolStep("a"),
      msg("assistant", "answer one"),
      msg("user", "second"),
      toolStep("b"),
      toolStep("c"),
      msg("assistant", "answer two"),
    ]
    render(
      <TooltipProvider>
        <MessageList messages={list} busy={false} />
      </TooltipProvider>,
    )
    const footers = screen.getAllByTestId("turn-footer")
    expect(footers).toHaveLength(2)
    // The last turn's footer follows its last step and carries Retry; earlier turns only Copy.
    const lastTurn = footers[1].closest("[data-role=assistant-turn]") as HTMLElement
    expect(within(lastTurn).getAllByTestId("tool-row")).toHaveLength(2)
    expect(lastTurn.lastElementChild).toBe(footers[1])
    expect(within(footers[0]).queryByRole("button", { name: "Retry" })).toBeNull()
    expect(within(footers[0]).getByRole("button", { name: "Copy" })).toBeInTheDocument()
    await user.click(within(footers[1]).getByRole("button", { name: "Retry" }))
    expect(regenerate).toHaveBeenCalledWith("ses_rust")
    regenerate.mockRestore()
  })

  it("keeps the latest turn's footer working while the session is busy between steps", () => {
    const list = [msg("user", "go"), toolStep("a")]
    render(
      <TooltipProvider>
        <MessageList messages={list} busy />
      </TooltipProvider>,
    )
    const footer = screen.getByTestId("turn-footer")
    expect(within(footer).queryByRole("button", { name: "Retry" })).toBeNull()
    expect(footer.closest("[data-role=assistant-turn]")).toHaveAttribute("data-streaming", "true")
  })
})
