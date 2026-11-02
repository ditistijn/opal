import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ConversationView } from "@/features/chat/ConversationView"
import { QuestionCard, SKIP_MESSAGE } from "@/features/chat/QuestionCard"
import type { FormInfo } from "@/lib/opencode/types"
import { mock, resetUI } from "./setup-mock"

vi.mock("@/lib/runtime", async () => {
  const { makeMockRuntime } = await import("@/lib/runtime/mock")
  return { runtime: makeMockRuntime({ latency: 1, persist: false }) }
})

const wrap = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>)

const QUESTION: FormInfo = {
  id: "frm_1",
  sessionID: "ses_rust",
  title: "Questions",
  metadata: { kind: "question" },
  fields: [
    {
      key: "q0",
      type: "string",
      title: "Lock",
      description: "Which lock should the cache use?",
      options: [
        { value: "Mutex (Recommended)", label: "Mutex (Recommended)", description: "Simple and fair" },
        { value: "RwLock", label: "RwLock", description: "Many readers, one writer" },
      ],
      custom: true,
    },
  ],
}

const SETTINGS: FormInfo = {
  id: "frm_2",
  sessionID: "ses_rust",
  title: "Deploy settings",
  fields: [
    { key: "env", type: "string", title: "Environment", required: true },
    { key: "canary", type: "boolean", title: "Canary first" },
    {
      key: "percent",
      type: "number",
      title: "Canary percent",
      minimum: 1,
      maximum: 50,
      required: true,
      when: [{ key: "canary", op: "eq", value: true }],
    },
  ],
}

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

describe("QuestionCard", () => {
  beforeEach(resetUI)

  it("shows the question with its options and answers with the chosen option", async () => {
    const reply = vi.spyOn(mock, "replyForm").mockResolvedValue()
    const user = userEvent.setup()
    wrap(<QuestionCard form={QUESTION} />)
    const card = screen.getByRole("dialog", { name: "Question" })
    expect(within(card).getByText("Which lock should the cache use?")).toBeInTheDocument()
    expect(within(card).getByText("Many readers, one writer")).toBeInTheDocument()
    await user.click(within(card).getByRole("radio", { name: /RwLock/ }))
    await user.click(within(card).getByRole("button", { name: /Submit/ }))
    expect(reply).toHaveBeenCalledWith("ses_rust", "frm_1", { q0: "RwLock" })
    reply.mockRestore()
  })

  it("sends a typed answer when the user types their own", async () => {
    const reply = vi.spyOn(mock, "replyForm").mockResolvedValue()
    const user = userEvent.setup()
    wrap(<QuestionCard form={QUESTION} />)
    await user.click(screen.getByRole("radio", { name: /Mutex/ }))
    await user.type(screen.getByLabelText("Lock: your own answer"), "ArcSwap")
    expect(screen.getByRole("radio", { name: /Mutex/ })).toHaveAttribute("aria-checked", "false")
    await user.click(screen.getByRole("button", { name: /Submit/ }))
    expect(reply).toHaveBeenCalledWith("ses_rust", "frm_1", { q0: "ArcSwap" })
    reply.mockRestore()
  })

  it("does not submit an empty answer, and Skip cancels with a note to the model", async () => {
    const reply = vi.spyOn(mock, "replyForm").mockResolvedValue()
    const cancel = vi.spyOn(mock, "cancelForm").mockResolvedValue()
    const user = userEvent.setup()
    wrap(<QuestionCard form={QUESTION} />)
    await user.click(screen.getByRole("button", { name: /Submit/ }))
    expect(reply).not.toHaveBeenCalled()
    expect(screen.getByText("Choose an answer or skip")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Skip" }))
    expect(cancel).toHaveBeenCalledWith("ses_rust", "frm_1", SKIP_MESSAGE)
    reply.mockRestore()
    cancel.mockRestore()
  })

  it("validates required fields and reveals `when` fields", async () => {
    const reply = vi.spyOn(mock, "replyForm").mockResolvedValue()
    const user = userEvent.setup()
    wrap(<QuestionCard form={SETTINGS} />)
    const card = screen.getByRole("dialog", { name: "Deploy settings" })
    expect(within(card).queryByLabelText("Canary percent")).toBeNull()
    await user.click(within(card).getByRole("radio", { name: "Yes" }))
    await user.click(within(card).getByRole("button", { name: /Submit/ }))
    expect(reply).not.toHaveBeenCalled()
    expect(within(card).getAllByText("Required")).toHaveLength(2)
    await user.type(within(card).getByLabelText("Environment"), "staging")
    await user.type(within(card).getByLabelText("Canary percent"), "80")
    expect(within(card).getByText("Must be at most 50")).toBeInTheDocument()
    await user.clear(within(card).getByLabelText("Canary percent"))
    await user.type(within(card).getByLabelText("Canary percent"), "10")
    await user.click(within(card).getByRole("button", { name: /Submit/ }))
    expect(reply).toHaveBeenCalledWith("ses_rust", "frm_2", { env: "staging", canary: true, percent: 10 })
    reply.mockRestore()
  })

  it("shows a server rejection inline", async () => {
    const reply = vi.spyOn(mock, "replyForm").mockRejectedValue(new Error("Form already settled: frm_1"))
    const user = userEvent.setup()
    wrap(<QuestionCard form={QUESTION} />)
    await user.click(screen.getByRole("radio", { name: /RwLock/ }))
    await user.click(screen.getByRole("button", { name: /Submit/ }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Form already settled")
    reply.mockRestore()
  })
})

describe("question tool in a conversation (mock runtime)", () => {
  beforeEach(resetUI)

  it("raises a paged question card, answers it, and the turn continues", async () => {
    const user = userEvent.setup()
    wrap(<Conversation id="ses_rust" />)
    await act(() => mock.sendPrompt("ses_rust", { text: "Ask me a question first" }))
    const card = await screen.findByRole("dialog", { name: "Question" })
    expect(within(card).getByRole("tab", { name: /Format/ })).toHaveAttribute("aria-selected", "true")
    await user.click(within(card).getByRole("radio", { name: /Table/ }))
    await user.click(within(card).getByRole("button", { name: "Next" }))
    await user.click(within(card).getByRole("checkbox", { name: /Next steps/ }))
    await user.click(within(card).getByRole("button", { name: /Submit/ }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Question" })).toBeNull())
    expect(await screen.findByText(/Got it — Table; Next steps/)).toBeInTheDocument()
    await waitFor(() => expect(mock.store.getState().activity.ses_rust).toBe("idle"))
    const row = screen.getAllByTestId("tool-row").at(-1)!
    expect(row).toHaveAttribute("data-status", "completed")
    expect(row).toHaveTextContent("Asked questions")
  })

  it("Stop clears a pending question", async () => {
    wrap(<Conversation id="ses_rust" />)
    await act(() => mock.sendPrompt("ses_rust", { text: "question time" }))
    await screen.findByRole("dialog", { name: "Question" })
    await act(() => mock.interrupt("ses_rust"))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Question" })).toBeNull())
  })
})
