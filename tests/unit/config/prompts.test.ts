import { describe, expect, it } from "vitest"
import {
  BUILTIN_PROMPTS,
  DEFAULT_MODE_FOR_SURFACE,
  isModeID,
  MODE_IDS,
  MODES,
  modesForSurface,
  renderAllPrompts,
  renderPrompt,
} from "@/lib/config/prompts"

describe("renderPrompt", () => {
  it("uses the built-in prompt without an override", () => {
    expect(renderPrompt("general", "  Built-in\r\nprompt  ")).toBe("Built-in\nprompt")
    expect(renderPrompt("general", "Built-in", "   ")).toBe("Built-in")
  })

  it("replaces the built-in prompt with an override", () => {
    expect(renderPrompt("general", "Built-in", "Only this.")).toBe("Only this.")
  })

  it("substitutes {{builtin}} to extend the built-in prompt", () => {
    expect(renderPrompt("code", "BASE", "Prefer Rust.\n\n{{builtin}}\n\nAlways run cargo test.")).toBe(
      "Prefer Rust.\n\nBASE\n\nAlways run cargo test.",
    )
  })

  it("renders every mode", () => {
    const all = renderAllPrompts({ code: "X" })
    expect(Object.keys(all).sort()).toEqual([...MODE_IDS].sort())
    expect(all.code).toBe("X")
    expect(all.artifact).toBe(BUILTIN_PROMPTS.artifact.trim())
  })
})

describe("built-in prompts", () => {
  it("are complete standalone prompts (they replace OpenCode's base prompt)", () => {
    for (const mode of MODE_IDS) {
      const prompt = BUILTIN_PROMPTS[mode]
      expect(prompt.length).toBeGreaterThan(2000)
      expect(prompt).toContain("Markdown")
      expect(prompt).toContain("system-reminder")
      expect(prompt).toContain("parallel")
      for (const tool of ["read", "edit", "write", "shell", "glob", "grep", "webfetch", "websearch"])
        expect(prompt, `${mode} mentions ${tool}`).toContain(`\`${tool}\``)
      expect(prompt).toContain("artifact_update")
    }
  })

  it("artifact prompt carries the full artifact policy", () => {
    const prompt = BUILTIN_PROMPTS.artifact
    for (const needle of [
      "artifact_create",
      "artifact_read",
      "index.html",
      ".tsx",
      ".mmd",
      ".svg",
      "uploads/",
      "Files",
      "replaces the entire file map",
      "same ID",
    ])
      expect(prompt).toContain(needle)
  })

  it("code prompt covers worktrees and git hygiene", () => {
    expect(BUILTIN_PROMPTS.code).toContain("worktree")
    expect(BUILTIN_PROMPTS.code).toContain("git reset --hard")
  })

  it("research prompt requires citations and uncertainty", () => {
    expect(BUILTIN_PROMPTS.research).toContain("Sources")
    expect(BUILTIN_PROMPTS.research.toLowerCase()).toContain("uncertainty")
  })
})

describe("inline widgets in the built-in prompts", () => {
  const prompts = renderAllPrompts({})
  const FENCES = ["```chart", "```widget", "```mermaid", "```svg"]

  it("chat prompts teach all four fences, the chart spec and the widget rules", () => {
    for (const mode of ["artifact", "general", "research"] as const) {
      const prompt = prompts[mode]
      for (const fence of FENCES) expect(prompt, `${mode} mentions ${fence}`).toContain(fence)
      for (const needle of [
        "datasets",
        "currency:",
        "percent",
        "var(--fg)",
        "var(--bg-elevated)",
        "100vh",
        "150 lines",
      ])
        expect(prompt, `${mode} mentions ${needle}`).toContain(needle)
      expect(prompt, `${mode} says no tool call`).toMatch(/no tool call/i)
      expect(prompt, `${mode} forbids nesting`).toMatch(/never inside a list item, quote, or table/)
    }
  })

  it("the artifact prompt has complete, valid examples of every fence", () => {
    const prompt = prompts.artifact
    const blocks = [...prompt.matchAll(/^```(\w+)[^\n]*\n([\s\S]*?)\n```$/gm)].map((m) => ({
      lang: m[1],
      body: m[2],
    }))
    expect(blocks.map((b) => b.lang)).toEqual(["chart", "widget", "mermaid", "svg"])
    const chart = JSON.parse(blocks[0].body)
    expect(chart.datasets.length).toBeGreaterThan(1)
    const widget = blocks[1].body
    expect(widget).toMatch(/^<!doctype html>/)
    expect(widget).toContain("window.opal.sendPrompt")
    expect(widget).toContain("</html>")
    expect(prompt).toContain("Talking about artifacts")
    expect(prompt.indexOf("## Inline widgets")).toBeLessThan(prompt.indexOf("## Talking about artifacts"))
  })

  it("the research prompt's example chart is valid JSON and the code prompt mentions charts", () => {
    const chart = /^```chart\n([\s\S]*?)\n```$/m.exec(prompts.research)?.[1]
    expect(() => JSON.parse(chart ?? "")).not.toThrow()
    expect(prompts.code).toContain("`chart`")
    expect(prompts.code).toMatch(/benchmark/)
  })
})

describe("MODES registry", () => {
  it("has a definition per mode with a valid agent color", () => {
    for (const id of MODE_IDS) {
      expect(MODES[id].id).toBe(id)
      expect(MODES[id].color).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(MODES[id].description.length).toBeGreaterThan(10)
    }
  })

  it("defaults per surface", () => {
    expect(DEFAULT_MODE_FOR_SURFACE).toEqual({ chat: "artifact", code: "code" })
    expect(modesForSurface("code").map((m) => m.id)).toEqual(["code"])
    expect(modesForSurface("chat").map((m) => m.id)).toContain("artifact")
    expect(isModeID("research")).toBe(true)
    expect(isModeID("build")).toBe(false)
  })
})
