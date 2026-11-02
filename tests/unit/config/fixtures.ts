import type { AppSettings, ModeID } from "@/lib/runtime/contracts"

export const PROMPTS: Record<ModeID, string> = {
  artifact: "ARTIFACT PROMPT",
  code: "CODE PROMPT",
  general: "GENERAL PROMPT",
  research: "RESEARCH PROMPT",
}

/** The project's acceptance scenario: Z.AI GLM-5.3 + a local Ollama + a disabled OpenRouter. */
export function fixtureSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    theme: "system",
    maxConcurrentConnections: 3,
    defaultModel: { providerID: "zai", id: "glm-5.3" },
    defaultMode: "artifact",
    promptOverrides: {},
    providers: [
      {
        id: "zai",
        name: "Z.AI",
        type: "openai-compatible",
        baseURL: "https://api.z.ai/api/paas/v4/",
        models: [
          {
            id: "glm-5.3",
            name: "GLM-5.3",
            contextWindow: 1_000_000,
            maxOutputTokens: 32_768,
            capabilities: { tools: true, vision: false, reasoning: true },
            enabled: true,
          },
        ],
        enabled: true,
      },
      {
        id: "ollama",
        name: "Ollama",
        type: "ollama",
        models: [{ id: "qwen3:8b", name: "qwen3:8b (8.2B)", capabilities: { tools: true }, enabled: true }],
        enabled: true,
      },
      {
        id: "openrouter",
        name: "OpenRouter",
        type: "openrouter",
        headers: { "X-Title": "Opal" },
        models: [{ id: "z-ai/glm-4.6", name: "GLM-4.6", enabled: true }],
        enabled: false,
      },
    ],
    projects: [],
    codeSurface: { useWorktrees: true, permissionMode: "ask" },
    sidebarCollapsed: false,
    lastSurface: "chat",
    sandbox: { mode: "filesystem", allowPaths: [] },
    remote: { enabled: false, lan: true },
    updates: { autoCheck: true },
    ...overrides,
  }
}
