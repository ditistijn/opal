import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ConversationView } from "@/features/chat/ConversationView"
import { PermissionCard } from "@/features/chat/PermissionCard"
import ChatSurface from "@/features/chat/ChatSurface"
import { useNav } from "@/features/chat/nav-store"
import { useDrafts } from "@/features/composer/drafts"
import { mock, resetUI } from "./setup-mock"

vi.mock("@/lib/runtime", async () => {
  const { makeMockRuntime } = await import("@/lib/runtime/mock")
  return { runtime: makeMockRuntime({ latency: 1, persist: false }) }
})

const wrap = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>)

function Conversation({ id }: { id: string }) {
  const session = mock.useSession(id)
  return session ? (
    <ConversationView
      session={session}
      artifactOpen={false}
      hasArtifacts={false}
      onToggleArtifact={() => {}}
    />
  ) : null
}

describe("PermissionCard", () => {
  beforeEach(resetUI)

  it.each([
    ["Allow once", "once"],
    ["Always allow", "always"],
    ["Deny", "reject"],
  ] as const)("%s replies %s", async (label, decision) => {
    const spy = vi.spyOn(mock, "replyPermission")
    const user = userEvent.setup()
    wrap(
      <PermissionCard
        request={{
          id: "perm_1",
          sessionID: "ses_rust",
          action: "bash",
          resources: ["rm -rf build/"],
          message: "Run a cleanup command?",
        }}
      />,
    )
    expect(screen.getByText("Run a cleanup command?")).toBeInTheDocument()
    expect(screen.getByText("rm -rf build/")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: label }))
    expect(spy).toHaveBeenCalledWith("ses_rust", "perm_1", decision)
    spy.mockRestore()
  })

  it("renders above the composer while pending and disappears after a reply", async () => {
    const user = userEvent.setup()
    wrap(<Conversation id="ses_rust" />)
    act(() =>
      mock.pushPermission({
        id: "perm_2",
        sessionID: "ses_rust",
        action: "edit",
        resources: ["~/notes/*"],
        message: "Edit notes?",
      }),
    )
    const card = await screen.findByRole("alertdialog", { name: "Permission request" })
    await user.click(within(card).getByRole("button", { name: "Allow once" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })
})

describe("ConversationView", () => {
  beforeEach(resetUI)

  it("renders user bubble, thinking, tool rows and an artifact card", () => {
    wrap(<Conversation id="ses_dashboard" />)
    expect(screen.getByText(/turn this spreadsheet into a dashboard/)).toBeInTheDocument()
    expect(screen.getAllByTestId("attachment-chip")[0]).toHaveTextContent("revenue-q3.csv")
    expect(screen.getByTestId("thinking")).toHaveTextContent("Thought for 6s")
    expect(screen.getByTestId("tool-row")).toHaveTextContent("Read file")
    expect(screen.getByTestId("artifact-card")).toHaveTextContent("Q3 revenue dashboard")
  })

  it("streams a reply, shows stop while busy, and returns to idle", async () => {
    const user = userEvent.setup()
    wrap(<Conversation id="ses_rust" />)
    await user.type(screen.getByRole("textbox", { name: "Message" }), "explain lifetimes{Enter}")
    expect(await screen.findByRole("button", { name: "Stop generating" })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument(), {
      timeout: 3000,
    })
    expect(screen.getByText(/break the problem into small/)).toBeInTheDocument()
  })

  it("stop interrupts generation", async () => {
    const user = userEvent.setup()
    wrap(<Conversation id="ses_rust" />)
    await user.type(screen.getByRole("textbox", { name: "Message" }), "explain{Enter}")
    await user.click(await screen.findByRole("button", { name: "Stop generating" }))
    await waitFor(() => expect(mock.store.getState().activity.ses_rust).toBe("idle"))
  })

  it("shows queued when the concurrency limit is reached", async () => {
    await act(() => mock.updateSettings({ maxConcurrentConnections: 1 }))
    const user = userEvent.setup()
    wrap(<Conversation id="ses_rust" />)
    await act(() => mock.sendPrompt("ses_espresso", { text: "please delete things" })) // waits on a permission → stays busy
    await user.type(screen.getByRole("textbox", { name: "Message" }), "hi{Enter}")
    expect(await screen.findByRole("status")).toHaveTextContent("Queued")
    await act(() => mock.interrupt("ses_rust"))
    await act(() => mock.interrupt("ses_espresso"))
    await act(() => mock.updateSettings({ maxConcurrentConnections: 3 }))
  })
})

describe("drag and drop", () => {
  beforeEach(resetUI)

  it("shows the overlay and adds dropped files as chips to the visible conversation", async () => {
    useNav.setState({ view: { kind: "session", sessionID: "ses_rust" } })
    wrap(<ChatSurface />)
    const main = screen.getByRole("main", { name: "Chat" })
    const file = new File(["hello"], "report.pdf", { type: "application/pdf" })
    const dataTransfer = { types: ["Files"], files: [file], dropEffect: "none" }
    const fire = (type: string) => {
      const ev = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(ev, "dataTransfer", { value: dataTransfer })
      act(() => {
        main.dispatchEvent(ev)
      })
    }
    fire("dragenter")
    fire("dragover")
    expect(screen.getByTestId("drop-overlay")).toHaveTextContent("Drop files to add to the conversation")
    fire("drop")
    await waitFor(() => expect(useDrafts.getState().files.ses_rust).toHaveLength(1))
    expect(screen.queryByTestId("drop-overlay")).toBeNull()
    const chip = await screen.findByTestId("attachment-chip")
    expect(chip).toHaveTextContent("report.pdf")
    await userEvent.setup().click(within(chip).getByRole("button", { name: "Remove report.pdf" }))
    expect(screen.queryByTestId("attachment-chip")).toBeNull()
  })
})
