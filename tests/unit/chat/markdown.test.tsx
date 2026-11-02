import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { Markdown } from "@/components/markdown/Markdown"
import { normalizeLang } from "@/components/markdown/shiki"

describe("Markdown", () => {
  it("renders GFM: emphasis, lists, tables and inline code", () => {
    const { container } = render(
      <Markdown text={"Hello **world** and `x`\n\n- one\n- two\n\n| a | b |\n|---|--:|\n| 1 | 2 |"} />,
    )
    expect(screen.getByText("world").tagName).toBe("STRONG")
    expect(screen.getByText("x")).toHaveClass("opal-inline-code")
    expect(container.querySelectorAll("li")).toHaveLength(2)
    expect(container.querySelector("table th")?.textContent).toBe("a")
  })

  it("renders fenced code blocks with a language label and copy button", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    const { container } = render(<Markdown text={"```ts\nconst a = 1\n```"} />)
    expect(container.querySelector(".opal-code")?.getAttribute("data-lang")).toBe("typescript")
    expect(container.querySelector("pre code")?.textContent).toBe("const a = 1")
    await user.click(screen.getByRole("button", { name: "Copy code" }))
    expect(writeText).toHaveBeenCalledWith("const a = 1")
    expect(screen.getByText("Copied")).toBeInTheDocument()
  })

  it("does not render raw HTML from model output", () => {
    const { container } = render(<Markdown text={'<img src=x onerror="alert(1)"> <b>bold</b>'} />)
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("b")).toBeNull()
  })

  it("marks streaming text for the caret", () => {
    const { container } = render(<Markdown text="partial" streaming />)
    expect(container.firstElementChild).toHaveClass("opal-streaming")
  })

  it("normalizes language aliases", () => {
    expect(normalizeLang("py")).toBe("python")
    expect(normalizeLang("SH")).toBe("bash")
    expect(normalizeLang(undefined)).toBe("")
  })
})
