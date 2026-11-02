import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { countChanges, parsePatch, shikiLines, splitRows } from "@/features/code/diff-parse"
import { DiffFileList, DiffPane } from "@/features/code/DiffPane"
import { DiffView } from "@/features/code/DiffView"
import { AUTH_DIFF, AUTH_TEST_DIFF } from "@/lib/runtime/mock/code"
import { resetCode } from "./setup"

vi.mock("@/lib/runtime", async () => {
  const { makeMockRuntime } = await import("@/lib/runtime/mock")
  return { runtime: makeMockRuntime({ latency: 1, persist: false }) }
})
vi.mock("@/lib/runtime/code", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/runtime/code")>()
  const { makeMockCodeRuntime } = await import("@/lib/runtime/mock/code")
  return { ...actual, codeRuntime: makeMockCodeRuntime() }
})
vi.mock("@/components/markdown/shiki", () => ({ highlightCode: async () => null }))

const GIT_PATCH = `diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,4 @@
 # acme

-old line
+new line
+another
\\ No newline at end of file
diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -10 +10 @@ function x()
-a
+b
`

describe("parsePatch", () => {
  it("parses createTwoFilesPatch output with line numbers", () => {
    const hunks = parsePatch(AUTH_DIFF.patch)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]).toMatchObject({ oldStart: 2, newStart: 2 })
    expect(countChanges(hunks)).toEqual({ additions: AUTH_DIFF.additions, deletions: AUTH_DIFF.deletions })
    const first = hunks[0].lines[0]
    expect(first).toMatchObject({ kind: "context", oldNo: 2, newNo: 2 })
    const firstAdd = hunks[0].lines.find((l) => l.kind === "add")!
    expect(firstAdd.newNo).toBe(6)
    expect(hunks[0].lines.at(-1)).toMatchObject({ kind: "context", text: "}", oldNo: 9, newNo: 15 })
  })

  it("parses git-style multi-file patches, blank context lines and no-newline markers", () => {
    const hunks = parsePatch(GIT_PATCH)
    expect(hunks).toHaveLength(2)
    expect(hunks[0].lines.map((l) => l.kind)).toEqual(["context", "context", "del", "add", "add"])
    expect(hunks[0].lines[4].noNewline).toBe(true)
    expect(hunks[1]).toMatchObject({ oldStart: 10, newStart: 10 })
    expect(hunks[1].lines.map((l) => [l.kind, l.text])).toEqual([
      ["del", "a"],
      ["add", "b"],
    ])
  })

  it("pairs deletions with additions for split view", () => {
    const rows = splitRows(parsePatch(GIT_PATCH)[0].lines)
    expect(rows.map((r) => [r.left?.text, r.right?.text])).toEqual([
      ["# acme", "# acme"],
      ["", ""],
      ["old line", "new line"],
      [undefined, "another"],
    ])
  })

  it("splits shiki html into lines", () => {
    const html =
      '<pre class="shiki"><code><span class="line"><span style="--shiki-light:#1">a</span></span>\n<span class="line"></span></code></pre>'
    expect(shikiLines(html)).toEqual(['<span style="--shiki-light:#1">a</span>', ""])
  })
})

describe("diff rendering", () => {
  beforeEach(resetCode)

  it("renders the changed-file list from FileDiff fixtures", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<DiffFileList files={[AUTH_DIFF, AUTH_TEST_DIFF]} onSelect={onSelect} />)
    const items = within(screen.getByRole("list", { name: "Changed files" })).getAllByRole("button")
    expect(items.map((i) => i.textContent)).toEqual([
      "Mauth.tssrc/middleware+9 −3",
      "Mauth.test.tstests+13 −0",
    ])
    await user.click(items[1])
    expect(onSelect).toHaveBeenCalledWith("tests/auth.test.ts")
  })

  it("renders unified and split tables", () => {
    const { container, rerender } = render(<DiffView patch={AUTH_DIFF.patch} path={AUTH_DIFF.file} />)
    expect(container.querySelectorAll(".opal-diff-line.is-add")).toHaveLength(9)
    expect(container.querySelectorAll(".opal-diff-line.is-del")).toHaveLength(3)
    rerender(<DiffView patch={AUTH_DIFF.patch} path={AUTH_DIFF.file} mode="split" />)
    expect(container.querySelector('[data-mode="split"]')).not.toBeNull()
    expect(container.querySelectorAll("td.is-add").length).toBeGreaterThan(0)
  })

  it("shows the session diff and switches to the working tree", async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <DiffPane sessionID="ses_code_auth" directory="/Users/demo/Developer/acme-api" />
      </TooltipProvider>,
    )
    expect(screen.getByText("2 files changed")).toBeInTheDocument()
    expect(screen.getAllByText("src/middleware/auth.ts").length).toBeGreaterThan(0)
    await user.click(screen.getByRole("tab", { name: "Working tree" }))
    expect(await screen.findByText("1 file changed")).toBeInTheDocument()
    expect(screen.getAllByText("README.md").length).toBeGreaterThan(0)
  })
})
