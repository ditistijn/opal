import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ThinkingBlock } from "@/features/chat/ThinkingBlock"
import { WORKING_VERBS } from "@/features/chat/working-verbs"

const reasoning = (over: Partial<Parameters<typeof ThinkingBlock>[0]["part"]> = {}) => ({
  type: "reasoning" as const,
  text: "First, **inspect** the input.\n\n- check types\n- check bounds\n\nThen write the code.",
  time: { created: 1_000, completed: 7_000 },
  ...over,
})

describe("ThinkingBlock", () => {
  it("renders thinking as formatted markdown when expanded", async () => {
    render(<ThinkingBlock part={reasoning()} />)
    const toggle = screen.getByRole("button", { name: /thought for 6s/i })
    await userEvent.click(toggle)
    expect(screen.getByText("inspect").tagName).toBe("STRONG")
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
  })

  it("rotates playful verbs while streaming", () => {
    vi.useFakeTimers()
    try {
      render(<ThinkingBlock part={reasoning({ streaming: true, time: { created: 1_000 } })} />)
      const button = screen.getByRole("button")
      expect(button).toHaveTextContent("Thinking…")
      const seen = new Set<string>()
      for (let i = 0; i < 6; i++) {
        act(() => vi.advanceTimersByTime(2600))
        seen.add(button.textContent?.replace("…", "").trim() ?? "")
      }
      expect(seen.size).toBeGreaterThan(1)
      for (const verb of seen) expect(WORKING_VERBS as readonly string[]).toContain(verb)
    } finally {
      vi.useRealTimers()
    }
  })
})
