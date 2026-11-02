import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useCodeNav } from "@/features/code/code-nav"
import { NewSessionDialog } from "@/features/code/NewSessionDialog"
import { ACME, mock, resetCode } from "./setup"

vi.mock("@/lib/runtime", async () => {
  const { makeMockRuntime } = await import("@/lib/runtime/mock")
  return { runtime: makeMockRuntime({ latency: 1, persist: false }) }
})
vi.mock("@/lib/runtime/code", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/runtime/code")>()
  const { makeMockCodeRuntime } = await import("@/lib/runtime/mock/code")
  return { ...actual, codeRuntime: makeMockCodeRuntime() }
})

const DEFAULT_MODEL = { providerID: "anthropic", id: "claude-sonnet-4-5" }

function open() {
  useCodeNav.setState({ newSession: { open: true, repo: ACME } })
  return render(
    <TooltipProvider>
      <NewSessionDialog />
    </TooltipProvider>,
  )
}

describe("NewSessionDialog", () => {
  beforeEach(() => {
    resetCode()
    vi.restoreAllMocks()
  })

  it("creates a worktree first, then a code session in it (default from settings)", async () => {
    const user = userEvent.setup()
    const createWorktree = vi.spyOn(mock, "createWorktree")
    const createSession = vi.spyOn(mock, "createSession")
    open()
    expect(screen.getByRole("switch", { name: "Run in an isolated worktree" })).toBeChecked()
    await user.type(screen.getByRole("textbox", { name: "Session title" }), "Fix login bug")
    await user.click(screen.getByRole("button", { name: "Create session" }))
    await waitFor(() => expect(createSession).toHaveBeenCalled())
    expect(createWorktree).toHaveBeenCalledWith(ACME, undefined, "opal/fix-login-bug")
    const wt = await createWorktree.mock.results[0].value
    expect(createSession).toHaveBeenCalledWith({
      surface: "code",
      directory: wt.directory,
      repoDirectory: ACME,
      worktreeBranch: "opal/fix-login-bug",
      mode: "code",
      model: DEFAULT_MODEL,
      title: "Fix login bug",
    })
    const created = await createSession.mock.results[0].value
    expect(useCodeNav.getState().sessionID).toBe(created.id)
    expect(mock.getOpalMetadata(created)).toMatchObject({
      repoDirectory: ACME,
      worktreeBranch: "opal/fix-login-bug",
    })
    await waitFor(() => expect(useCodeNav.getState().newSession.open).toBe(false))
  })

  it("creates a session directly in the repository when the worktree toggle is off", async () => {
    const user = userEvent.setup()
    const createWorktree = vi.spyOn(mock, "createWorktree")
    const createSession = vi.spyOn(mock, "createSession")
    open()
    await user.click(screen.getByRole("switch", { name: "Run in an isolated worktree" }))
    expect(screen.queryByRole("textbox", { name: "New branch" })).toBeNull()
    await user.click(screen.getByRole("button", { name: "Create session" }))
    await waitFor(() => expect(createSession).toHaveBeenCalled())
    expect(createWorktree).not.toHaveBeenCalled()
    expect(createSession).toHaveBeenCalledWith({
      surface: "code",
      directory: ACME,
      mode: "code",
      model: DEFAULT_MODEL,
      title: undefined,
    })
  })

  it("uses an explicit branch name and shows errors inline", async () => {
    const user = userEvent.setup()
    vi.spyOn(mock, "createWorktree").mockRejectedValueOnce(new Error("fatal: invalid reference: nope"))
    open()
    await user.type(screen.getByRole("textbox", { name: "New branch" }), "feature/x")
    await user.click(screen.getByRole("button", { name: "Create session" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid reference")
    expect(mock.createWorktree).toHaveBeenCalledWith(ACME, undefined, "feature/x")
    expect(useCodeNav.getState().newSession.open).toBe(true)
  })
})
