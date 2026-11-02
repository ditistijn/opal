import { describe, expect, it } from "vitest"
import { agentPermissions, buildOpenCodeConfig, packageForProvider } from "@/lib/config/build"
import { normalizeSettings } from "@/lib/runtime/stores/settings"
import { renderAllPrompts } from "@/lib/config/prompts"
import { fixtureSettings, PROMPTS } from "./fixtures"

describe("buildOpenCodeConfig", () => {
  it("matches the snapshot for the GLM fixture", () => {
    expect(buildOpenCodeConfig({ settings: fixtureSettings(), prompts: PROMPTS })).toMatchSnapshot()
  })

  it("matches the snapshot with the sandbox shell", () => {
    const config = buildOpenCodeConfig({
      settings: fixtureSettings(),
      prompts: PROMPTS,
      sandboxShellPath: "/Users/me/Library/Application Support/Opal/bin/sandbox/zsh",
    })
    expect(config).toMatchSnapshot()
  })

  it("sets the top-level shell whenever the wrapper exists (it scrubs credentials even with the sandbox off)", () => {
    const wrapper = "/opal/bin/sandbox/zsh"
    const build = (mode: "off" | "filesystem" | "strict", sandboxShellPath?: string) =>
      buildOpenCodeConfig({
        settings: fixtureSettings({ sandbox: { mode, allowPaths: [] } }),
        prompts: PROMPTS,
        sandboxShellPath,
      }).shell
    expect(build("filesystem", wrapper)).toBe(wrapper)
    expect(build("strict", wrapper)).toBe(wrapper)
    expect(build("off", wrapper)).toBe(wrapper)
    expect(build("filesystem")).toBeUndefined()
    expect(build("filesystem", "relative/zsh")).toBeUndefined()
  })

  it("produces the documented top-level shape", () => {
    const config = buildOpenCodeConfig({ settings: fixtureSettings(), prompts: PROMPTS })
    expect(config.$schema).toBe("https://opencode.ai/config.json")
    expect(config.model).toBe("zai/glm-5.3")
    expect(config.default_agent).toBe("artifact")
    expect(config.experimental).toEqual({ artifacts: true, subagent_depth: 1 })
    expect(Object.keys(config.agents).sort()).toEqual(["artifact", "code", "general", "research"])
    expect(config.agents.artifact.system).toBe("ARTIFACT PROMPT")
    expect(config.agents.artifact.color).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it("maps provider types to packages and fills local defaults", () => {
    const config = buildOpenCodeConfig({ settings: fixtureSettings(), prompts: PROMPTS })
    expect(config.providers.zai).toMatchObject({
      name: "Z.AI",
      package: "@ai-sdk/openai-compatible",
      settings: { baseURL: "https://api.z.ai/api/paas/v4" },
      models: { "glm-5.3": { name: "GLM-5.3", limit: { context: 1_000_000, output: 32_768 } } },
    })
    expect(config.providers.ollama.settings).toEqual({ baseURL: "http://127.0.0.1:11434/v1" })
    expect(packageForProvider({ type: "openrouter" })).toBe("@openrouter/ai-sdk-provider")
    expect(packageForProvider({ type: "lmstudio" })).toBe("@ai-sdk/openai-compatible")
    expect(packageForProvider({ type: "custom", package: "@ai-sdk/mistral" })).toBe("@ai-sdk/mistral")
  })

  it("omits disabled providers and denies them by policy", () => {
    const config = buildOpenCodeConfig({ settings: fixtureSettings(), prompts: PROMPTS })
    expect(config.providers.openrouter).toBeUndefined()
    expect(config.policies).toEqual([{ action: "provider.use", resource: "openrouter", effect: "deny" }])
  })

  it("never writes API keys in credential mode, even when present", () => {
    const settings = fixtureSettings()
    settings.providers[0].apiKey = "sk-secret-1234"
    const config = buildOpenCodeConfig({ settings, prompts: PROMPTS })
    expect(JSON.stringify(config)).not.toContain("sk-secret-1234")
  })

  it("writes settings.apiKey only in explicit file mode", () => {
    const settings = fixtureSettings()
    settings.providers[0].apiKey = "sk-secret-1234"
    const config = buildOpenCodeConfig({ settings, prompts: PROMPTS }, { apiKeyStorage: "file" })
    expect(config.providers.zai.settings).toEqual({
      baseURL: "https://api.z.ai/api/paas/v4",
      apiKey: "sk-secret-1234",
    })
    expect(config.providers.ollama.settings).not.toHaveProperty("apiKey")
  })

  it("maps capabilities to OpenCode's schema (partial)", () => {
    const config = buildOpenCodeConfig({ settings: fixtureSettings(), prompts: PROMPTS })
    expect(config.providers.zai.models?.["glm-5.3"].capabilities).toEqual({
      tools: true,
      input: ["text"],
      output: ["text"],
      reasoning: { supported: true },
    })
    expect(config.providers.ollama.models?.["qwen3:8b"].capabilities).toEqual({ tools: true })
  })

  it("skips invalid model ids and marks disabled models", () => {
    const settings = fixtureSettings()
    settings.providers[0].models.push(
      { id: "bad#id", name: "Bad", enabled: true },
      { id: "", name: "Empty" },
      { id: "glm-4.6", name: "GLM-4.6", enabled: false },
    )
    const models = buildOpenCodeConfig({ settings, prompts: PROMPTS }).providers.zai.models ?? {}
    expect(Object.keys(models)).toEqual(["glm-5.3", "glm-4.6"])
    expect(models["glm-4.6"].disabled).toBe(true)
  })

  it("sanitizes provider ids used as keys and in the default model", () => {
    const settings = fixtureSettings({ defaultModel: { providerID: "My Proxy", id: "glm-5.3" } })
    settings.providers.push({
      id: "My Proxy",
      name: "My Proxy",
      type: "openai-compatible",
      baseURL: "https://proxy.example.com/v1",
      models: [{ id: "glm-5.3", name: "GLM-5.3" }],
      enabled: true,
    })
    const config = buildOpenCodeConfig({ settings, prompts: PROMPTS })
    expect(config.providers["my-proxy"]).toBeDefined()
    expect(config.model).toBe("my-proxy/glm-5.3")
    for (const id of Object.keys(config.providers)) expect(id).toMatch(/^[a-z0-9][a-z0-9._-]*$/)
  })

  it("drops the default model when its provider is disabled", () => {
    const config = buildOpenCodeConfig({
      settings: fixtureSettings({ defaultModel: { providerID: "openrouter", id: "z-ai/glm-4.6" } }),
      prompts: PROMPTS,
    })
    expect(config.model).toBeUndefined()
  })

  it("keeps a catalog-provider default model (provider not managed by Opal)", () => {
    const config = buildOpenCodeConfig({
      settings: fixtureSettings({
        defaultModel: { providerID: "opencode", id: "big-pickle", variant: "high" },
      }),
      prompts: PROMPTS,
    })
    expect(config.model).toBe("opencode/big-pickle#high")
  })

  it("is deterministic", () => {
    const a = JSON.stringify(buildOpenCodeConfig({ settings: fixtureSettings(), prompts: PROMPTS }))
    const b = JSON.stringify(buildOpenCodeConfig({ settings: fixtureSettings(), prompts: PROMPTS }))
    expect(a).toBe(b)
  })

  it("renders prompt overrides into the agents", () => {
    const prompts = renderAllPrompts({ research: "Custom research.\n\n{{builtin}}" }, PROMPTS)
    const config = buildOpenCodeConfig({ settings: fixtureSettings(), prompts })
    expect(config.agents.research.system).toBe("Custom research.\n\nRESEARCH PROMPT")
    expect(config.agents.code.system).toBe("CODE PROMPT")
  })

  it("keeps the general agent usable as OpenCode's built-in subagent", () => {
    const config = buildOpenCodeConfig({ settings: fixtureSettings(), prompts: PROMPTS })
    expect(config.agents.general.mode).toBe("all")
    expect(config.agents.artifact.mode).toBe("primary")
  })
})

describe("agentPermissions", () => {
  it("chat modes ask only when leaving the sandbox", () => {
    for (const mode of ["artifact", "general", "research"] as const)
      expect(agentPermissions(mode, { codeSurface: { useWorktrees: true, permissionMode: "ask" } })).toEqual([
        { action: "execute", resource: "*", effect: "deny" },
        { action: "external_directory", resource: "*", effect: "ask" },
      ])
  })

  it("code mode 'ask' asks for edits and shell but allows read-only commands (last match wins)", () => {
    const rules = agentPermissions("code", { codeSurface: { useWorktrees: false, permissionMode: "ask" } })
    expect(rules[0]).toEqual({ action: "execute", resource: "*", effect: "deny" })
    expect(rules[1]).toEqual({ action: "edit", resource: "*", effect: "ask" })
    expect(rules[2]).toEqual({ action: "shell", resource: "*", effect: "ask" })
    expect(rules).toContainEqual({ action: "shell", resource: "git status *", effect: "allow" })
  })

  it("code mode 'auto' still asks for risky commands", () => {
    const rules = agentPermissions("code", { codeSurface: { useWorktrees: false, permissionMode: "auto" } })
    expect(rules).not.toContainEqual({ action: "edit", resource: "*", effect: "ask" })
    expect(rules).toContainEqual({ action: "shell", resource: "git push *", effect: "ask" })
    expect(rules).toContainEqual({ action: "shell", resource: "rm -rf *", effect: "ask" })
  })
})

describe("security & remote settings", () => {
  it("defaults to the filesystem sandbox and remote control off", () => {
    const s = normalizeSettings({})
    expect(s.sandbox).toEqual({ mode: "filesystem", allowPaths: [] })
    expect(s.remote).toEqual({ enabled: false, lan: true })
  })

  it("normalizes malformed sandbox and remote values", () => {
    const s = normalizeSettings({
      sandbox: { mode: "bogus", allowPaths: ["/a", "/a", "relative", 3] },
      remote: { enabled: "yes", lan: false },
    })
    expect(s.sandbox).toEqual({ mode: "filesystem", allowPaths: ["/a"] })
    expect(s.remote).toEqual({ enabled: false, lan: false })
    expect(normalizeSettings({ sandbox: { mode: "strict" } }).sandbox.mode).toBe("strict")
  })
})

describe("providerCompatibility", () => {
  it("relaxes finish_reason for OpenAI-compatible endpoints unless strict streaming is on", async () => {
    const { providerCompatibility } = await import("@/lib/config/build")
    expect(providerCompatibility({ type: "openai-compatible" })).toEqual({ requireFinishReason: false })
    expect(providerCompatibility({ type: "ollama" })).toEqual({ requireFinishReason: false })
    expect(providerCompatibility({ type: "openai-compatible", strictStreaming: true })).toBeUndefined()
    expect(providerCompatibility({ type: "anthropic" })).toBeUndefined()
    expect(providerCompatibility({ type: "openai" })).toBeUndefined()
  })
})
