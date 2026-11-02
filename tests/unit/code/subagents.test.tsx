import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SubagentsPane } from "@/features/code/SubagentsPane"
import { resetCode } from "./setup"

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

function Harness({ sessionID }: { sessionID: string }) {
  const [openID, setOpenID] = useState<string>()
  return (
    <TooltipProvider>
      <SubagentsPane sessionID={sessionID} openID={openID} onOpen={setOpenID} />
    </TooltipProvider>
  )
}

describe("SubagentsPane", () => {
  beforeEach(resetCode)

  it("lists child sessions as a tree and opens a read-only transcript", async () => {
    const user = userEvent.setup()
    render(<Harness sessionID="ses_code_vitest" />)
    const tree = screen.getByRole("tree", { name: "Subagents" })
    const items = within(tree).getAllByRole("treeitem")
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining("Audit jest config usage"),
      expect.stringContaining("Port snapshot tests"),
    ])
    await user.click(within(items[0]).getByText("Audit jest config usage"))
    const drawer = await screen.findByRole("dialog", { name: "Subagent: Audit jest config usage" })
    expect(await within(drawer).findByText(/Jest-specific calls across 6 files/)).toBeInTheDocument()
    // Read-only: no edit affordance on the child's prompt.
    expect(within(drawer).queryByRole("button", { name: /edit/i })).toBeNull()
    await user.click(within(drawer).getByRole("button", { name: "Close subagent transcript" }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("shows an empty state when the session has no subagents", () => {
    render(<Harness sessionID="ses_code_auth" />)
    expect(screen.getByText("No subagents yet")).toBeInTheDocument()
  })
})
