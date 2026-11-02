import { describe, expect, it } from "vitest"
import type { SessionInfo } from "@/lib/opencode/types"
import { identifier, newSessionID } from "@/lib/opencode/ids"
import { fileURL, guessMime, isMedia, withAttachmentNote } from "@/lib/runtime/attachments"
import { projectInstructions, sandboxInstructions } from "@/lib/runtime/instructions"
import { mapCliProviders, providerTypeFor } from "@/lib/runtime/providers"
import { defaultBranchName, slugify } from "@/lib/runtime/sessions-api"
import { getOpalMetadata, selectSessions } from "@/lib/runtime/stores/sessions"
import { DEFAULT_SETTINGS, normalizeSettings } from "@/lib/runtime/stores/settings"

describe("ids", () => {
  it("generates OpenCode-shaped session ids that sort newest first", () => {
    const a = identifier(true, 1_000)
    const b = identifier(true, 2_000)
    expect(b < a).toBe(true)
    expect(newSessionID()).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
    expect(identifier(false, 1_000) < identifier(false, 2_000)).toBe(true)
  })
})

describe("attachments", () => {
  it("classifies media", () => {
    expect(isMedia(guessMime({ name: "a.PNG" }))).toBe(true)
    expect(isMedia("application/pdf")).toBe(true)
    expect(isMedia(guessMime({ name: "a.csv" }))).toBe(false)
    expect(isMedia("image/svg+xml")).toBe(false)
    expect(guessMime({ name: "x", mime: "text/x-custom" })).toBe("text/x-custom")
  })

  it("encodes file URLs and appends notes only when needed", () => {
    expect(fileURL("/Users/me/My Files/a#1.png")).toBe("file:///Users/me/My%20Files/a%231.png")
    expect(withAttachmentNote("hi", [], "x")).toBe("hi")
    expect(withAttachmentNote("hi", ["- uploads/a.csv"], "Files:")).toContain(
      "<user_attachments>\nFiles:\n- uploads/a.csv",
    )
  })
})

describe("instructions", () => {
  it("describes the sandbox and the project", () => {
    expect(sandboxInstructions("/x/conversations/ses_1")).toContain("uploads/")
    const text = projectInstructions(
      { id: "p", name: "Launch", instructions: "Be brief.", knowledge: [], created: 0, updated: 0 },
      [{ path: "knowledge/spec.md", size: 2048 }],
    )
    expect(text).toContain('project "Launch"')
    expect(text).toContain("Be brief.")
    expect(text).toContain("- knowledge/spec.md (2 KB)")
  })
})

describe("CLI config import", () => {
  it("maps v1 provider entries and keeps literal keys only", () => {
    const mapped = mapCliProviders({
      provider: {
        zai: {
          npm: "@ai-sdk/openai-compatible",
          name: "Z.AI",
          options: { baseURL: "https://api.z.ai/v1", apiKey: "sk-literal" },
          models: {
            "glm-4.6": { name: "GLM 4.6", limit: { context: 200000, output: 8192 }, tool_call: true },
          },
        },
        local: {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "http://localhost:11434/v1", apiKey: "{env:KEY}" },
          models: {},
        },
      },
    })
    expect(mapped).toHaveLength(2)
    expect(mapped[0]).toEqual({
      provider: {
        id: "zai",
        name: "Z.AI",
        type: "openai-compatible",
        baseURL: "https://api.z.ai/v1",
        models: [
          {
            id: "glm-4.6",
            name: "GLM 4.6",
            contextWindow: 200000,
            maxOutputTokens: 8192,
            capabilities: { tools: true, vision: undefined, reasoning: undefined },
            enabled: true,
          },
        ],
        enabled: true,
      },
      apiKey: "sk-literal",
    })
    expect(mapped[1]!.provider.type).toBe("ollama")
    expect(mapped[1]!.apiKey).toBeUndefined()
  })

  it("detects provider types from packages", () => {
    expect(providerTypeFor("@ai-sdk/anthropic", undefined)).toBe("anthropic")
    expect(providerTypeFor("@openrouter/ai-sdk-provider", undefined)).toBe("openrouter")
    expect(providerTypeFor("@ai-sdk/openai", undefined)).toBe("openai")
    expect(providerTypeFor("some-pkg", undefined)).toBe("custom")
  })
})

describe("worktree branch names", () => {
  it("uses opal/<slug>-<4 chars>", () => {
    expect(slugify("My Repo!")).toBe("my-repo")
    expect(defaultBranchName("/Users/me/dev/My Repo")).toMatch(/^opal\/my-repo-[0-9a-z]{4}$/)
  })
})

function session(id: string, patch: Partial<SessionInfo> = {}, opal?: Record<string, unknown>): SessionInfo {
  return {
    id,
    projectID: "p",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    location: { directory: `/d/${id}` },
    ...(opal ? { metadata: { opal } } : {}),
    ...patch,
  } as SessionInfo
}

describe("sessions", () => {
  it("reads Opal metadata with defaults", () => {
    expect(getOpalMetadata(session("a"))).toEqual({ surface: "code", directory: "/d/a" })
    expect(
      getOpalMetadata(session("b", {}, { surface: "chat", projectID: "x", directory: "/s" })),
    ).toMatchObject({ surface: "chat", projectID: "x", directory: "/s" })
  })

  it("filters by surface/project/archived/search and sorts by update time", () => {
    const byID = Object.fromEntries(
      [
        session("c1", { title: "Budget", time: { created: 1, updated: 5 } }, { surface: "chat" }),
        session(
          "c2",
          { title: "Trip", time: { created: 1, updated: 9 } },
          { surface: "chat", projectID: "p1" },
        ),
        session("c3", { title: "Old", time: { created: 1, updated: 7, archived: 8 } }, { surface: "chat" }),
        session("k1", { title: "Code" }, { surface: "code" }),
        session("child", { parentID: "c1" }, { surface: "chat" }),
      ].map((s) => [s.id, s]),
    )
    expect(selectSessions(byID, { surface: "chat" }).map((s) => s.id)).toEqual(["c2", "c1"])
    expect(selectSessions(byID, { surface: "chat", projectID: "p1" }).map((s) => s.id)).toEqual(["c2"])
    expect(selectSessions(byID, { surface: "chat", archived: true }).map((s) => s.id)).toEqual(["c3"])
    expect(selectSessions(byID, { surface: "chat", search: "bud" }).map((s) => s.id)).toEqual(["c1"])
    expect(selectSessions(byID, { surface: "code" }).map((s) => s.id)).toEqual(["k1"])
  })
})

describe("settings", () => {
  it("fills defaults, clamps concurrency and strips keys", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    const s = normalizeSettings({
      maxConcurrentConnections: 0,
      providers: [{ id: "a", name: "A", type: "openai", apiKey: "secret", models: [], enabled: true }],
      codeSurface: { permissionMode: "auto" },
    })
    expect(s.maxConcurrentConnections).toBe(3)
    expect(s.providers[0]).not.toHaveProperty("apiKey")
    expect(s.codeSurface).toEqual({ useWorktrees: true, permissionMode: "auto" })
  })

  it("normalizes the updates settings (auto-check on unless explicitly off)", () => {
    expect(normalizeSettings({}).updates).toEqual({ autoCheck: true })
    expect(normalizeSettings({ updates: { autoCheck: false } }).updates).toEqual({ autoCheck: false })
    expect(normalizeSettings({ updates: { autoCheck: "no" } }).updates).toEqual({ autoCheck: true })
    expect(normalizeSettings({ updates: null }).updates).toEqual({ autoCheck: true })
  })
})
