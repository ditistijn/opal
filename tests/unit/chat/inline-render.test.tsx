import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { cloneElement, isValidElement, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { sendPrompt } = vi.hoisted(() => ({
  sendPrompt: vi.fn((_sessionID: string, _input: { text: string }) => Promise.resolve()),
}))
vi.mock("@/lib/runtime", () => ({ runtime: { sendPrompt } }))

// jsdom has no layout: give the chart a fixed size instead of measuring its container
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <div data-testid="chart-container">
        {isValidElement<{ width?: number; height?: number }>(children)
          ? cloneElement(children, { width: 600, height: 280 })
          : children}
      </div>
    ),
  }
})

import { Markdown } from "@/components/markdown/Markdown"
import { useDrafts } from "@/features/composer/drafts"
import { InlineBlock } from "@/features/chat/inline/InlineBlock"

const WIDGET = "<!doctype html><html><body><button>Go</button></body></html>"
const fence = (lang: string, body: string, info = "") => `\`\`\`${lang}${info}\n${body}\n\`\`\``

function frame(container: HTMLElement) {
  return container.querySelector<HTMLIFrameElement>("iframe[data-testid=inline-widget-frame]")!
}

function postFrom(win: Window, data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source: win }))
  })
}

beforeEach(() => {
  sendPrompt.mockClear()
  useDrafts.setState({ text: {}, files: {} })
  document.documentElement.dataset.theme = "light"
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(() => {
  delete document.documentElement.dataset.theme
})

describe("Markdown routing", () => {
  it("shows a placeholder while the fence is still streaming, never a partial widget", () => {
    const { container } = render(<Markdown streaming text={'Here:\n\n```widget title="Fleet"\n<div>par'} />)
    expect(screen.getByText("Building widget…")).toBeInTheDocument()
    expect(screen.getByText("Fleet")).toBeInTheDocument()
    expect(container.querySelector("iframe")).toBeNull()
    expect(container.querySelector(".opal-code")).toBeNull()
  })

  it("renders the block once the fence closes, even mid-stream", () => {
    const { container } = render(
      <Markdown streaming text={`${fence("widget", WIDGET, ' title="Fleet"')}\n\nMore`} />,
    )
    expect(screen.queryByText("Building widget…")).toBeNull()
    expect(frame(container)).toBeTruthy()
    expect(frame(container).getAttribute("sandbox")).toBe("allow-scripts allow-forms allow-pointer-lock")
    expect(frame(container).src).toContain("/artifact-runtime/widget.html?bridge=1&theme=light")
  })

  it("keeps the iframe mounted when streaming ends", () => {
    const text = `${fence("widget", WIDGET)}\n\nDone`
    const { container, rerender } = render(<Markdown streaming text={text} />)
    const before = frame(container)
    rerender(<Markdown text={text} />)
    expect(frame(container)).toBe(before)
  })

  it("routes each reserved language and leaves other code alone", () => {
    const text = [
      fence("chart", "{nope"),
      fence(
        "svg",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4"/></svg>',
        ' title="Box"',
      ),
      fence("mermaid", "graph TD; A-->B"),
      fence("ts", "const a = 1"),
    ].join("\n\n")
    const { container } = render(<Markdown text={text} />)
    expect(screen.getByText(/Not a valid chart: invalid JSON/)).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "Box" })).toHaveAttribute(
      "src",
      expect.stringMatching(/^data:image\/svg\+xml/),
    )
    expect(container.querySelector("[data-inline-kind=mermaid] iframe")).toBeTruthy()
    expect(container.querySelector('.opal-code[data-lang="typescript"]')).toBeTruthy()
  })
})

describe("InlineBlock", () => {
  it("toggles the source view", async () => {
    const user = userEvent.setup()
    const { container } = render(<InlineBlock kind="widget" code={WIDGET} title="Calc" />)
    const button = screen.getByRole("button", { name: "Source" })
    expect(button).toHaveAttribute("aria-expanded", "false")
    await user.click(button)
    expect(container.querySelector(".opal-code pre code")?.textContent).toBe(WIDGET)
    await user.click(screen.getByRole("button", { name: "Hide source" }))
    expect(container.querySelector(".opal-code")).toBeNull()
  })

  it("rejects an unsafe svg as code with a note", () => {
    render(<InlineBlock kind="svg" code="<html><script>alert(1)</script></html>" />)
    expect(screen.getByText(/Not a valid SVG/)).toBeInTheDocument()
    expect(screen.queryByRole("img")).toBeNull()
  })

  it("renders a chart with title, legend and dataset tabs", async () => {
    const user = userEvent.setup()
    const spec = {
      title: "Store performance",
      subtitle: "Sample data",
      type: "bar",
      x: ["Jan", "Feb", "Mar"],
      note: "Orders exclude refunds.",
      datasets: [
        {
          label: "Revenue",
          format: "currency:EUR",
          series: [
            { name: "Online", data: [10, 20, 30] },
            { name: "Retail", data: [5, 6, 7] },
          ],
        },
        {
          label: "Orders",
          type: "line",
          series: [
            { name: "Orders", data: [1, 2, 3] },
            { name: "Returns", data: [0, 1, 0] },
          ],
        },
      ],
    }
    const { container } = render(<InlineBlock kind="chart" code={JSON.stringify(spec)} />)
    expect(screen.getByTestId("inline-title")).toHaveTextContent("Store performance")
    expect(screen.getByText("Sample data")).toBeInTheDocument()
    expect(screen.getByText("Orders exclude refunds.")).toBeInTheDocument()
    const legend = await screen.findByRole("group", { name: "Legend" })
    expect(legend).toHaveTextContent("Online")
    expect(legend).toHaveTextContent("Retail")
    expect(container.querySelector("[data-chart-type=bar]")).toBeTruthy()

    // legend items toggle series and are buttons (keyboard reachable)
    const online = screen.getByRole("button", { name: "Online" })
    await user.click(online)
    expect(online).toHaveAttribute("aria-pressed", "false")

    await user.click(screen.getByRole("tab", { name: "Orders" }))
    await waitFor(() => expect(container.querySelector("[data-chart-type=line]")).toBeTruthy())
    expect(screen.getByRole("group", { name: "Legend" })).toHaveTextContent("Returns")
  })
})

describe("WidgetFrame bridge", () => {
  it("posts the document on opal:ready and follows opal:resize within 80–640px", () => {
    const { container } = render(<InlineBlock kind="widget" code={WIDGET} sessionID="ses_1" />)
    const iframe = frame(container)
    const win = iframe.contentWindow!
    const posted = vi.spyOn(win, "postMessage").mockImplementation(() => {})

    postFrom(win, { type: "opal:ready" })
    return waitFor(() =>
      expect(posted).toHaveBeenCalledWith(
        expect.objectContaining({ type: "opal:files", entry: "index.html", files: { "index.html": WIDGET } }),
        "*",
      ),
    ).then(() => {
      postFrom(win, { type: "opal:resize", height: 312.4 })
      expect(iframe.style.height).toBe("313px")
      postFrom(win, { type: "opal:resize", height: 4000 })
      expect(iframe.style.height).toBe("640px")
      postFrom(win, { type: "opal:resize", height: 3 })
      expect(iframe.style.height).toBe("80px")
      // messages from anything but the frame are ignored
      postFrom(window, { type: "opal:resize", height: 300 })
      expect(iframe.style.height).toBe("80px")
    })
  })

  it("sends short widget prompts (rate-limited) and drafts long ones", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000)
    const { container } = render(<InlineBlock kind="widget" code={WIDGET} sessionID="ses_1" />)
    const win = frame(container).contentWindow!
    postFrom(win, { type: "opal:prompt", text: "Explain step 2" })
    postFrom(win, { type: "opal:prompt", text: "Explain step 3" })
    expect(sendPrompt).toHaveBeenCalledTimes(1)
    expect(sendPrompt).toHaveBeenCalledWith("ses_1", { text: "Explain step 2" })

    now.mockReturnValue(11_500)
    const long = "x".repeat(201)
    postFrom(win, { type: "opal:prompt", text: long })
    expect(sendPrompt).toHaveBeenCalledTimes(1)
    expect(useDrafts.getState().text.ses_1).toBe(long)
    now.mockRestore()
  })

  it("shows errors with Ask Opal to fix", async () => {
    const user = userEvent.setup()
    const { container } = render(<InlineBlock kind="widget" code={WIDGET} title="Calc" sessionID="ses_1" />)
    postFrom(frame(container).contentWindow!, { type: "opal:error", message: "x is not defined" })
    expect(screen.getByTestId("inline-widget-error")).toHaveTextContent("x is not defined")
    await user.click(screen.getByRole("button", { name: /Ask Opal to fix/ }))
    expect(sendPrompt).toHaveBeenCalledWith("ses_1", {
      text: expect.stringContaining("x is not defined"),
    })
  })

  it("reloads with the new theme", async () => {
    const { container } = render(<InlineBlock kind="widget" code={WIDGET} />)
    expect(frame(container).src).toContain("theme=light")
    act(() => {
      document.documentElement.dataset.theme = "dark"
    })
    await waitFor(() => expect(frame(container).src).toContain("theme=dark"))
  })

  it("does not reload when re-rendered with identical text", () => {
    const { container, rerender } = render(<InlineBlock kind="widget" code={WIDGET} />)
    const first = frame(container)
    rerender(<InlineBlock kind="widget" code={WIDGET} />)
    expect(frame(container)).toBe(first)
  })
})
