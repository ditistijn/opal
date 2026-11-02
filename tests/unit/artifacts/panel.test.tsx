import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ArtifactContent, ArtifactInfo } from "@/lib/opencode/types"
import type { ArtifactView } from "@/lib/runtime/contracts"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ArtifactPanelView } from "@/features/artifacts/ArtifactPanelView"
import type { ArtifactRuntime } from "@/features/artifacts/types"

vi.mock("@/features/artifacts/highlight", () => ({ highlightCode: async () => undefined }))

const info = (id: string, title: string, entry: string): ArtifactInfo =>
  ({
    id,
    title,
    entry,
    provider: "local",
    url: "",
    sessionID: "ses_1",
    time: { created: 1, updated: 2 },
  }) as unknown as ArtifactInfo

function makeRt(active: string | undefined, contents: ArtifactContent[]) {
  const setActive = vi.fn()
  const rt: ArtifactRuntime = {
    useArtifacts: () => contents.map((c) => c.info),
    useArtifact: (id) => {
      const c = contents.find((x) => x.info.id === id)
      return c
        ? ({ info: c.info, kind: "react", previewURL: "", versions: [] } satisfies ArtifactView)
        : undefined
    },
    useActiveArtifact: () => ({ artifactID: active, setActive }),
    getArtifactContent: async (id) => contents.find((c) => c.info.id === id)!,
    updateArtifact: vi.fn(async () => {}),
    restoreArtifactVersion: vi.fn(async () => {}),
    sendPrompt: vi.fn(async () => {}),
  }
  return { rt, setActive }
}

const wrap = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>)

describe("ArtifactPanelView", () => {
  it("shows an empty state without artifacts", () => {
    const { rt } = makeRt(undefined, [])
    wrap(<ArtifactPanelView sessionID="ses_1" rt={rt} />)
    expect(screen.getByTestId("artifact-empty")).toHaveTextContent("No artifacts yet")
  })

  it("lets the user open one of the session's artifacts", () => {
    const a = { info: info("art_a", "Chart", "App.tsx"), files: { "App.tsx": "x" } }
    const { rt, setActive } = makeRt(undefined, [a])
    wrap(<ArtifactPanelView sessionID="ses_1" rt={rt} />)
    fireEvent.click(screen.getByText("Chart"))
    expect(setActive).toHaveBeenCalledWith("art_a")
  })

  it("renders header, kind badge and a sandboxed iframe for the active artifact", async () => {
    const a = {
      info: info("art_a", "Landing page", "index.html"),
      files: { "index.html": "<p>hi</p>", "s.css": "" },
    }
    const { rt, setActive } = makeRt("art_a", [a])
    wrap(<ArtifactPanelView sessionID="ses_1" rt={rt} />)
    expect(screen.getByTestId("artifact-header")).toHaveTextContent("Landing page")
    await waitFor(() => expect(screen.getByTestId("artifact-kind")).toHaveTextContent("HTML"))
    const iframe = screen.getByTestId("artifact-iframe")
    expect(iframe.getAttribute("src")).toMatch(
      /^\/artifact-runtime\/html\.html\?bridge=1&id=art_a&entry=index\.html/,
    )
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin")
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer")
    fireEvent.click(screen.getByTestId("artifact-close"))
    expect(setActive).toHaveBeenCalledWith(undefined)
  })

  it("edits a file in the code view and saves a new version", async () => {
    const a = { info: info("art_a", "App", "App.tsx"), files: { "App.tsx": "old", "util.ts": "u" } }
    const { rt } = makeRt("art_a", [a])
    wrap(<ArtifactPanelView sessionID="ses_1" rt={rt} />)
    fireEvent.click(screen.getByRole("tab", { name: "Code" }))
    await waitFor(() => expect(screen.getByTestId("artifact-code")).toHaveTextContent("old"))
    expect(screen.getByRole("tab", { name: "util.ts" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }))
    fireEvent.change(screen.getByTestId("artifact-editor"), { target: { value: "new" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(rt.updateArtifact).toHaveBeenCalledWith("art_a", { "App.tsx": "new", "util.ts": "u" }),
    )
  })

  it("toggles full screen and exits on Escape", () => {
    const a = { info: info("art_a", "App", "App.tsx"), files: { "App.tsx": "x" } }
    const { rt } = makeRt("art_a", [a])
    wrap(<ArtifactPanelView sessionID="ses_1" rt={rt} />)
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }))
    expect(screen.getByTestId("artifact-panel")).toHaveAttribute("data-fullscreen")
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.getByTestId("artifact-panel")).not.toHaveAttribute("data-fullscreen")
  })
})
