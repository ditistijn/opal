import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useCodeNav } from "@/features/code/code-nav"
import { CodeSidebar } from "@/features/code/CodeSidebar"
import { CodeStatusReporter } from "@/features/code/CodeStatusDot"
import { groupByRepo, isWorktreeSession, repoOf } from "@/features/code/group-by-repo"
import type { SessionInfo } from "@/lib/opencode/types"
import type { OpalSessionMetadata } from "@/lib/runtime"
import { ACME, SITE, resetCode } from "./setup"

vi.mock("@/lib/runtime", async () => {
  const { makeMockRuntime } = await import("@/lib/runtime/mock")
  return { runtime: makeMockRuntime({ latency: 1, persist: false }) }
})
vi.mock("@/lib/runtime/code", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/runtime/code")>()
  const { makeMockCodeRuntime } = await import("@/lib/runtime/mock/code")
  return { ...actual, codeRuntime: makeMockCodeRuntime() }
})

function session(id: string, updated: number, meta: Partial<OpalSessionMetadata>): SessionInfo {
  return {
    id,
    projectID: "p",
    agent: "code",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: updated, updated },
    title: id,
    metadata: { opal: { surface: "code", ...meta } },
    location: { directory: meta.directory ?? "/x" },
  } as SessionInfo
}
const metaOf = (s: SessionInfo) => s.metadata!.opal as unknown as OpalSessionMetadata

describe("groupByRepo", () => {
  const repos = [
    { directory: "/r/one", name: "one" },
    { directory: "/r/two", name: "two" },
  ]
  it("groups by metadata repo, then known worktree, then directory; keeps empty known repos", () => {
    const sessions = [
      session("a", 5, { directory: "/wt/a", repoDirectory: "/r/one", worktreeBranch: "opal/a" }),
      session("b", 4, { directory: "/r/one/" }),
      session("c", 3, { directory: "/wt/c" }),
      session("d", 2, { directory: "/elsewhere/repo" }),
    ]
    const groups = groupByRepo(sessions, repos, { "/wt/c": "/r/one" }, metaOf)
    expect(groups.map((g) => [g.repo.name, g.sessions.map((s) => s.id)])).toEqual([
      ["one", ["a", "b", "c"]],
      ["two", []],
      ["repo", ["d"]],
    ])
  })
  it("detects worktree sessions", () => {
    expect(isWorktreeSession({ surface: "code", directory: "/wt/a", repoDirectory: "/r/one" }, {})).toBe(true)
    expect(isWorktreeSession({ surface: "code", directory: "/wt/c" }, { "/wt/c": "/r/one" })).toBe(true)
    expect(isWorktreeSession({ surface: "code", directory: "/r/one" }, {})).toBe(false)
    expect(repoOf({ surface: "code", directory: "/r/one/" }, {})).toBe("/r/one")
  })
})

describe("CodeSidebar", () => {
  beforeEach(resetCode)

  it("lists sessions under their repository with branch badges and status", async () => {
    render(
      <TooltipProvider>
        <CodeSidebar />
        <CodeStatusReporter sessionIDs={["ses_code_rate", "ses_code_auth"]} />
      </TooltipProvider>,
    )
    const acme = screen.getByRole("region", { name: "acme-api" })
    const site = screen.getByRole("region", { name: "marketing-site" })
    expect(acme).toHaveAttribute("data-repo", ACME)
    expect(site).toHaveAttribute("data-repo", SITE)
    const acmeRows = within(acme)
      .getAllByRole("listitem")
      .map((r) => r.getAttribute("data-session"))
    expect(acmeRows.sort()).toEqual(["ses_code_auth", "ses_code_rate", "ses_code_vitest"])
    expect(
      within(site)
        .getAllByRole("listitem")
        .map((r) => r.getAttribute("data-session")),
    ).toEqual(["ses_site_hero"])
    // Subagent child sessions never show in the sidebar; chat sessions neither.
    expect(screen.queryByText("Audit jest config usage")).toBeNull()
    expect(screen.queryByText("Q3 revenue dashboard")).toBeNull()
    // Worktree badge with its branch.
    expect(within(acme).getByLabelText("Worktree branch opal/vitest-4")).toBeInTheDocument()
    expect(within(acme).getByText("Needs permission")).toBeInTheDocument()
  })

  it("opens a session and collapses a repo", async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <CodeSidebar />
      </TooltipProvider>,
    )
    const row = document.querySelector('[data-session="ses_code_auth"]') as HTMLElement
    await user.click(within(row).getByText("Fix flaky auth middleware test"))
    expect(useCodeNav.getState().sessionID).toBe("ses_code_auth")
    await user.click(screen.getByRole("button", { name: "marketing-site" }))
    expect(screen.queryByText("Tighten hero section copy and spacing")).toBeNull()
  })
})
