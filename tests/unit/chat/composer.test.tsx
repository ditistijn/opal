import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Composer, type ComposerProps } from "@/features/composer/Composer"
import { useDrafts } from "@/features/composer/drafts"
import { resetUI } from "./setup-mock"

vi.mock("@/lib/runtime", async () => {
  const { makeMockRuntime } = await import("@/lib/runtime/mock")
  return { runtime: makeMockRuntime({ latency: 1, persist: false }) }
})

function setup(props: Partial<ComposerProps> = {}) {
  const onSubmit = vi.fn()
  const onStop = vi.fn()
  const utils = render(
    <TooltipProvider>
      <Composer
        draftKey="k"
        mode="general"
        onModeChange={() => {}}
        onSubmit={onSubmit}
        onStop={onStop}
        {...props}
      />
    </TooltipProvider>,
  )
  return { ...utils, onSubmit, onStop, textbox: screen.getByRole("textbox", { name: "Message" }) }
}

describe("Composer", () => {
  beforeEach(resetUI)

  it("sends on Enter, keeps newline on Shift+Enter, and clears the draft", async () => {
    const user = userEvent.setup()
    const { textbox, onSubmit } = setup()
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled()
    await user.type(textbox, "hello{Shift>}{Enter}{/Shift}world")
    expect(textbox).toHaveValue("hello\nworld")
    await user.keyboard("{Enter}")
    expect(onSubmit).toHaveBeenCalledWith({ text: "hello\nworld", files: undefined })
    expect(textbox).toHaveValue("")
  })

  it("keeps drafts per key", async () => {
    const user = userEvent.setup()
    const { textbox, rerender } = setup()
    await user.type(textbox, "draft for k")
    const props = { mode: "general" as const, onModeChange() {}, onSubmit() {} }
    rerender(
      <TooltipProvider>
        <Composer draftKey="other" {...props} />
      </TooltipProvider>,
    )
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("")
    rerender(
      <TooltipProvider>
        <Composer draftKey="k" {...props} />
      </TooltipProvider>,
    )
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("draft for k")
  })

  it("shows a stop button while busy and does not send", async () => {
    const user = userEvent.setup()
    const { textbox, onSubmit, onStop } = setup({ activity: "busy" })
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull()
    await user.type(textbox, "more{Enter}")
    expect(onSubmit).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Stop generating" }))
    expect(onStop).toHaveBeenCalled()
  })

  it("shows the queued state with a cancel button", async () => {
    const user = userEvent.setup()
    const { onStop } = setup({ activity: "queued" })
    expect(screen.getByRole("status")).toHaveTextContent("Queued")
    await user.click(screen.getByRole("button", { name: "Cancel queued message" }))
    expect(onStop).toHaveBeenCalled()
  })

  it("attaches uploaded files as removable chips and sends them", async () => {
    const user = userEvent.setup()
    const { onSubmit, textbox } = setup()
    const input = screen.getByTestId("file-input") as HTMLInputElement
    await user.upload(input, new File(["a,b\n1,2"], "data.csv", { type: "text/csv" }))
    expect(await screen.findByText("data.csv")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Remove data.csv" }))
    expect(screen.queryByText("data.csv")).toBeNull()
    await user.upload(input, new File(["x"], "notes.md", { type: "text/markdown" }))
    await screen.findByText("notes.md")
    fireEvent.keyDown(textbox, { key: "Enter" })
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const sent = onSubmit.mock.calls[0][0]
    expect(sent.files).toHaveLength(1)
    expect(sent.files[0]).toMatchObject({ name: "notes.md", mime: "text/markdown" })
    expect(sent.files[0].id).toBeUndefined()
    expect(useDrafts.getState().files.k).toHaveLength(0)
  })
})
