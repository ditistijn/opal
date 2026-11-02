import { describe, expect, it } from "vitest"
import { DEFAULT_PROMPT1, DEFAULT_TIMEOUT_MS, parseSmokeConfig } from "@/lib/smoke/config"
import { htmlProblem } from "@/lib/smoke/content"
import { nonceOf } from "@/lib/smoke/dom"
import { Recorder } from "@/lib/smoke/report"
import { waitFor } from "@/lib/smoke/wait"

describe("parseSmokeConfig", () => {
  it("fills defaults for a create run", () => {
    const c = parseSmokeConfig({ name: "accept", model: { providerID: "zai", id: "glm-5.3" }, exit: true })
    expect(c).toMatchObject({
      name: "accept",
      phase: "create",
      prompt1: DEFAULT_PROMPT1,
      model: { providerID: "zai", id: "glm-5.3" },
      importCliConfig: false,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      exit: true,
    })
  })

  it("validates names, phases, models and reopen ids", () => {
    expect(() => parseSmokeConfig(null)).toThrow(/object/)
    expect(() => parseSmokeConfig({ name: "../x" })).toThrow(/name/)
    expect(() => parseSmokeConfig({ phase: "later" })).toThrow(/phase/)
    expect(() => parseSmokeConfig({ model: { id: "x" } })).toThrow(/providerID/)
    expect(() => parseSmokeConfig({ phase: "reopen", sessionID: "ses_1" })).toThrow(/artifactID/)
    expect(parseSmokeConfig({ phase: "reopen", sessionID: "ses_1", artifactID: "art_1" }).phase).toBe(
      "reopen",
    )
    expect(parseSmokeConfig({ timeoutMs: 5 }).timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
  })
})

describe("waitFor", () => {
  it("resolves with the first defined value", async () => {
    let n = 0
    await expect(
      waitFor("n ≥ 3", () => (++n >= 3 ? n : undefined), { timeoutMs: 1000, intervalMs: 1 }),
    ).resolves.toBe(3)
  })

  it("times out with the described state and the last probe error", async () => {
    await expect(
      waitFor(
        "never",
        () => {
          throw new Error("boom")
        },
        { timeoutMs: 20, intervalMs: 5, describe: () => "state x" },
      ),
    ).rejects.toThrow(/timed out after 0s waiting for never \(state x; last error: boom\)/)
  })

  it("stops early on a failure condition", async () => {
    await expect(
      waitFor("render", () => undefined, { timeoutMs: 1000, intervalMs: 1, fail: () => "render error: x" }),
    ).rejects.toThrow("render: render error: x")
  })
})

describe("Recorder", () => {
  it("records steps, stops after the first failure and never throws", async () => {
    const rec = new Recorder("accept", "create", () => undefined)
    expect(await rec.step("a", "A", async (d) => void (d.x = 1))).toBe(true)
    expect(await rec.step("b", "B", async () => Promise.reject(new Error("nope")))).toBe(false)
    expect(await rec.step("c", "C", async () => undefined)).toBe(false)
    rec.extra.sessionID = "ses_1"
    const report = rec.report()
    expect(report.ok).toBe(false)
    expect(report.failedStep).toBe("b")
    expect(report.sessionID).toBe("ses_1")
    expect(report.steps.map((s) => [s.id, s.ok])).toEqual([
      ["a", true],
      ["b", false],
    ])
    expect(report.steps[0].detail).toEqual({ x: 1 })
    expect(report.steps[1].error).toBe("nope")
  })

  it("is ok only when every step passed", async () => {
    const rec = new Recorder("r", "reopen", () => undefined)
    expect(rec.report().ok).toBe(false)
    await rec.step("a", "A", async () => undefined)
    expect(rec.report().ok).toBe(true)
  })
})

describe("nonceOf", () => {
  it("reads the v= cache-buster", () => {
    expect(nonceOf("artifact://localhost/art_x/index.html?v=123")).toBe("123")
    expect(nonceOf("artifact://localhost/art_x/index.html")).toBeUndefined()
    expect(nonceOf(undefined)).toBeUndefined()
  })
})

describe("htmlProblem", () => {
  const page = `<!doctype html><html><head><title>x</title></head><body>${"<div>row</div>".repeat(20)}</body></html>`
  it("accepts a real page", () => expect(htmlProblem(page)).toBeUndefined())
  it("rejects placeholders and file references", () => {
    for (const p of ["<<FILE:index.html>>", " @index.html ", "{{index.html}}", "./index.html", "index.html"])
      expect(htmlProblem(p)).toMatch(/placeholder/)
  })
  it("rejects tiny or markup-free files", () => {
    expect(htmlProblem("<p>hi</p>")).toMatch(/only/)
    expect(htmlProblem("x".repeat(500))).toMatch(/no HTML markup/)
  })
})
