import { describe, expect, it } from "vitest"
import { parseOpenCodeCliConfig } from "@/lib/config/cli-import"

describe("parseOpenCodeCliConfig", () => {
  it("imports a v1 custom provider (the shape of the user's CLI config) and separates the key", () => {
    const result = parseOpenCodeCliConfig({
      $schema: "https://opencode.ai/config.json",
      model: "shimiao/glm-5.3",
      provider: {
        shimiao: {
          npm: "@ai-sdk/openai-compatible",
          name: "Shimiaocheng",
          options: { baseURL: "https://proxy.example.com/v1", apiKey: "sk-test-not-real" },
          models: { "glm-5.3": { name: "GLM-5.3", limit: { context: 1000000, output: 32768 } } },
        },
      },
    })
    expect(result).toEqual([
      {
        provider: {
          id: "shimiao",
          name: "Shimiaocheng",
          type: "openai-compatible",
          baseURL: "https://proxy.example.com/v1",
          models: [
            { id: "glm-5.3", name: "GLM-5.3", contextWindow: 1000000, maxOutputTokens: 32768, enabled: true },
          ],
          enabled: true,
        },
        apiKey: "sk-test-not-real",
      },
    ])
    expect(result[0].provider).not.toHaveProperty("apiKey")
  })

  it("imports v2 providers and skips {env:…} key placeholders", () => {
    const [entry] = parseOpenCodeCliConfig({
      providers: {
        deepseek: {
          name: "DeepSeek",
          package: "aisdk:@ai-sdk/openai-compatible",
          settings: { baseURL: "https://api.deepseek.com/v1", apiKey: "{env:DEEPSEEK_API_KEY}" },
          models: {
            "deepseek-reasoner": {
              capabilities: { tools: true, input: ["text"], reasoning: { supported: true } },
            },
          },
        },
      },
    })
    expect(entry.apiKey).toBeUndefined()
    expect(entry.provider.type).toBe("openai-compatible")
    expect(entry.provider.models[0]).toEqual({
      id: "deepseek-reasoner",
      name: "deepseek-reasoner",
      capabilities: { tools: true, vision: false, reasoning: true },
      enabled: true,
    })
  })

  it("avoids id collisions with existing providers and maps unknown packages to custom", () => {
    const [entry] = parseOpenCodeCliConfig({ provider: { zai: { npm: "@ai-sdk/mistral", models: {} } } }, [
      "zai",
    ])
    expect(entry.provider.id).toBe("zai-2")
    expect(entry.provider.type).toBe("custom")
    expect(entry.provider.package).toBe("@ai-sdk/mistral")
  })

  it("ignores invalid input", () => {
    expect(parseOpenCodeCliConfig(null)).toEqual([])
    expect(parseOpenCodeCliConfig({ provider: "x" })).toEqual([])
  })
})
