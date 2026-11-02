import { render, screen, within, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Sidebar } from "@/features/sidebar/Sidebar"
import { SearchPalette } from "@/features/chat/SearchPalette"
import { groupFor, groupSessions } from "@/features/sidebar/group-sessions"
import { useNav } from "@/features/chat/nav-store"
import { makeSession } from "@/lib/runtime/mock/seed"
import { mock, resetUI } from "./setup-mock"

vi.mock("@/lib/runtime", async () => {
  const { makeMockRuntime } = await import("@/lib/runtime/mock")
  return { runtime: makeMockRuntime({ latency: 1, persist: false }) }
})

const NOW = new Date(2026, 10, 1, 15, 0).getTime()
const H = 3_600_000

describe("groupSessions", () => {
  it("buckets by calendar day relative to now", () => {
    expect(groupFor(NOW - 2 * H, NOW)).toBe("Today")
    expect(groupFor(new Date(2026, 10, 1, 0, 1).getTime(), NOW)).toBe("Today")
    expect(groupFor(new Date(2026, 9, 31, 23, 59).getTime(), NOW)).toBe("Yesterday")
    expect(groupFor(NOW - 3 * 24 * H, NOW)).toBe("Previous 7 days")
    expect(groupFor(NOW - 30 * 24 * H, NOW)).toBe("Older")
  })

  it("orders groups and sessions newest first and skips empty groups", () => {
    const mk = (id: string, updated: number) =>
      makeSession({ id, surface: "chat", created: updated, updated })
    const groups = groupSessions(
      [mk("old", NOW - 40 * 24 * H), mk("a", NOW - H), mk("b", NOW - 10 * 60_000)],
      NOW,
    )
    expect(groups.map((g) => g.label)).toEqual(["Today", "Older"])
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["b", "a"])
  })
})

describe("Sidebar", () => {
  beforeEach(resetUI)

  const renderSidebar = () =>
    render(
      <TooltipProvider>
        <Sidebar onNewChat={() => useNav.getState().go({ kind: "home" })} />
        <SearchPalette />
      </TooltipProvider>,
    )

  it("shows projects, starred and grouped recents", () => {
    renderSidebar()
    expect(screen.getByText("Opal launch")).toBeInTheDocument()
    const starred = screen.getByRole("region", { name: "Starred" })
    expect(within(starred).getByText("Q3 revenue dashboard")).toBeInTheDocument()
    const recents = screen.getByRole("region", { name: "Recents" })
    expect(within(recents).getByRole("group", { name: "Today" })).toBeInTheDocument()
    // starred chats are not repeated under Recents
    expect(within(recents).queryByText("Q3 revenue dashboard")).toBeNull()
  })

  it("opens a conversation on click and starring moves it to Starred", async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByText("Dialing in a new espresso grinder"))
    expect(useNav.getState().view).toEqual({ kind: "session", sessionID: "ses_espresso" })
    await act(() => mock.starSession("ses_espresso", true))
    expect(
      within(screen.getByRole("region", { name: "Starred" })).getByText("Dialing in a new espresso grinder"),
    ).toBeInTheDocument()
  })

  it("search palette filters conversations by title and body", async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByText("Search chats"))
    const input = await screen.findByRole("textbox", { name: "Search chats" })
    await user.type(input, "lisbon")
    const results = screen.getByRole("listbox", { name: "Results" })
    expect(within(results).getByText("Weekend itinerary for Lisbon")).toBeInTheDocument()
    expect(within(results).queryByText("Q3 revenue dashboard")).toBeNull()
    await user.clear(input)
    await user.type(input, "pandas") // only appears in a message body
    expect(within(results).getByText("Q3 revenue dashboard")).toBeInTheDocument()
    await user.keyboard("{ArrowDown}{Enter}")
    expect(useNav.getState().view).toEqual({ kind: "session", sessionID: "ses_dashboard" })
  })
})
