import { describe, expect, it, vi } from "vitest"
import { isValidModelID, isValidProviderID } from "@/lib/config/ids"
import {
  discoverModels,
  mergeDiscoveredModels,
  parseLMStudioModels,
  parseOllamaTags,
  parseOpenAIModels,
  pickTestModel,
  presetForProvider,
  PROVIDER_PRESETS,
} from "@/lib/config/provider-presets"

describe("PROVIDER_PRESETS", () => {
  it("have unique, valid ids", () => {
    const ids = PROVIDER_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(isValidProviderID(id)).toBe(true)
  })

  it("have valid URLs", () => {
    for (const preset of PROVIDER_PRESETS) {
      if (preset.id !== "custom") {
        const url = new URL(preset.baseURL)
        expect(["http:", "https:"]).toContain(url.protocol)
        if (!preset.local) expect(url.protocol).toBe("https:")
        expect(preset.baseURL.endsWith("/")).toBe(false)
      }
      expect(new URL(preset.docsURL).protocol).toBe("https:")
      if (preset.keyURL) expect(new URL(preset.keyURL).protocol).toBe("https:")
    }
  })

  it("have valid, unique suggested models with sane limits", () => {
    for (const preset of PROVIDER_PRESETS) {
      const ids = preset.models.map((model) => model.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const model of preset.models) {
        expect(isValidModelID(model.id)).toBe(true)
        expect(model.contextWindow).toBeGreaterThan(0)
        expect(model.maxOutputTokens).toBeGreaterThan(0)
        expect(model.maxOutputTokens!).toBeLessThanOrEqual(model.contextWindow!)
      }
    }
  })

  it("include the endpoints the project relies on", () => {
    const byID = Object.fromEntries(PROVIDER_PRESETS.map((preset) => [preset.id, preset]))
    expect(byID.zai.baseURL).toBe("https://api.z.ai/api/paas/v4")
    expect(byID.zai.models.map((model) => model.id)).toContain("glm-5.3")
    expect(byID.deepseek.baseURL).toBe("https://api.deepseek.com/v1")
    expect(byID.ollama.baseURL).toBe("http://127.0.0.1:11434/v1")
    expect(byID.lmstudio.baseURL).toBe("http://127.0.0.1:1234/v1")
  })

  it("match existing providers by id or host", () => {
    expect(
      presetForProvider({ id: "zai-2", type: "openai-compatible", baseURL: "https://api.z.ai/api/paas/v4" })
        ?.id,
    ).toBe("zai")
    expect(presetForProvider({ id: "local", type: "ollama" })?.id).toBe("ollama")
    expect(
      presetForProvider({ id: "x", type: "openai-compatible", baseURL: "https://unknown.example" }),
    ).toBeUndefined()
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

describe("discoverModels", () => {
  it("lists OpenAI-compatible models with the bearer key", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ data: [{ id: "glm-5.3", context_length: 1_000_000 }, { id: "glm-4.6" }] }),
    )
    const result = await discoverModels(
      { id: "zai", type: "openai-compatible", baseURL: "https://api.z.ai/api/paas/v4/", apiKey: "k-123" },
      { fetch: fetch as unknown as typeof globalThis.fetch },
    )
    expect(fetch).toHaveBeenCalledWith(
      "https://api.z.ai/api/paas/v4/models",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer k-123" }) }),
    )
    expect(result).toMatchObject({
      ok: true,
      models: [{ id: "glm-4.6" }, { id: "glm-5.3", contextWindow: 1_000_000 }],
    })
  })

  it("uses Ollama's /api/tags at the server root", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        models: [
          { name: "qwen3:8b", model: "qwen3:8b", details: { parameter_size: "8.2B", families: ["qwen3"] } },
          {
            name: "nomic-embed-text:latest",
            model: "nomic-embed-text:latest",
            details: { families: ["nomic-bert"] },
          },
        ],
      }),
    )
    const result = await discoverModels(
      { id: "ollama", type: "ollama" },
      { fetch: fetch as unknown as typeof globalThis.fetch },
    )
    expect((fetch.mock.calls[0] as unknown[])[0]).toBe("http://127.0.0.1:11434/api/tags")
    expect(result).toMatchObject({ ok: true, models: [{ id: "qwen3:8b", name: "qwen3:8b (8.2B)" }] })
  })

  it("reports network failures with a clear message", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch")
    })
    const result = await discoverModels(
      { id: "x", type: "openai-compatible", baseURL: "https://api.example.com/v1" },
      { fetch: fetch as unknown as typeof globalThis.fetch },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Couldn.t reach/)
  })

  it("explains auth failures", async () => {
    const fetch = vi.fn(async () => jsonResponse({ error: { message: "invalid key" } }, 401))
    const withKey = await discoverModels(
      { id: "x", type: "openai-compatible", baseURL: "https://api.example.com/v1", apiKey: "bad" },
      { fetch: fetch as unknown as typeof globalThis.fetch },
    )
    expect(withKey).toEqual({ ok: false, error: "The API key was rejected (401) — invalid key." })
  })

  it("explains a missing Ollama", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch")
    })
    const result = await discoverModels(
      { id: "ollama", type: "ollama" },
      { fetch: fetch as unknown as typeof globalThis.fetch },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("ollama serve")
  })

  it("requires an endpoint", async () => {
    expect(await discoverModels({ id: "x", type: "openai-compatible" })).toEqual({
      ok: false,
      error: "Enter the endpoint URL first.",
    })
  })
})

describe("parsers", () => {
  it("parse OpenRouter metadata", () => {
    const [model] = parseOpenAIModels({
      data: [
        {
          id: "z-ai/glm-4.6",
          name: "Z.AI: GLM 4.6",
          context_length: 202752,
          top_provider: { max_completion_tokens: 128000 },
          architecture: { input_modalities: ["text"], output_modalities: ["text"] },
          supported_parameters: ["tools", "reasoning"],
        },
      ],
    })
    expect(model).toEqual({
      id: "z-ai/glm-4.6",
      name: "Z.AI: GLM 4.6",
      contextWindow: 202752,
      maxOutputTokens: 128000,
      capabilities: { tools: true, vision: false, reasoning: true },
      enabled: true,
    })
  })

  it("filter OpenAI non-chat models when asked", () => {
    const models = parseOpenAIModels(
      { data: [{ id: "gpt-5" }, { id: "text-embedding-3-small" }, { id: "whisper-1" }] },
      true,
    )
    expect(models.map((m) => m.id)).toEqual(["gpt-5"])
  })

  it("drop relay models that only serve task endpoints (image/video/rerank)", () => {
    const models = parseOpenAIModels({
      data: [
        { id: "aigc-image-kling", supported_endpoint_types: ["aigc-image"] },
        { id: "doubao-seedance-2-0", supported_endpoint_types: ["Doubao video"] },
        { id: "BAAI/bge-reranker-v2-m3", supported_endpoint_types: ["rerank"] },
        { id: "gpt-6.1-sol", supported_endpoint_types: ["openai", "openai-response"] },
        { id: "glm-5.3", supported_endpoint_types: ["anthropic", "openai"] },
        { id: "untagged-model" },
      ],
    })
    expect(models.map((m) => m.id).sort()).toEqual(["glm-5.3", "gpt-6.1-sol", "untagged-model"])
  })

  it("route relay models that only serve the Responses endpoint through /responses", () => {
    const models = parseOpenAIModels({
      data: [
        { id: "gpt-6.1-sol", supported_endpoint_types: ["openai-response"] },
        { id: "gpt-6-luna", supported_endpoint_types: ["openai", "openai-response"] },
        { id: "glm-5.3", supported_endpoint_types: ["openai"] },
      ],
    })
    const api = Object.fromEntries(models.map((m) => [m.id, m.api]))
    expect(api).toEqual({ "gpt-6.1-sol": "responses", "gpt-6-luna": undefined, "glm-5.3": undefined })
  })

  it("pick a chat-capable model for the connection test", () => {
    expect(
      pickTestModel([
        { id: "aigc-image-kling" },
        { id: "aigc-video-hailuo" },
        { id: "BAAI/bge-reranker-v2-m3" },
        { id: "claude-opus-5", enabled: false },
        { id: "gpt-6.1-sol" },
      ]),
    ).toBe("gpt-6.1-sol")
    expect(pickTestModel([{ id: "kling-video" }])).toBe("kling-video")
    expect(pickTestModel([])).toBeUndefined()
  })

  it("parse LM Studio rich model list", () => {
    const models = parseLMStudioModels({
      data: [
        { id: "qwen2.5-vl-7b", type: "vlm", max_context_length: 32768 },
        { id: "text-embedding-nomic", type: "embeddings" },
      ],
    })
    expect(models).toEqual([
      {
        id: "qwen2.5-vl-7b",
        name: "qwen2.5-vl-7b",
        contextWindow: 32768,
        capabilities: { tools: true, vision: true, reasoning: false },
        enabled: true,
      },
    ])
  })

  it("tolerate junk", () => {
    expect(parseOpenAIModels(null)).toEqual([])
    expect(parseOllamaTags({ models: "nope" })).toEqual([])
  })
})

describe("mergeDiscoveredModels", () => {
  it("adopts a discovered API without overriding the user's choice", () => {
    const { models } = mergeDiscoveredModels(
      [
        { id: "a", name: "a" },
        { id: "b", name: "b", api: "chat" },
      ],
      [
        { id: "a", name: "a", api: "responses" },
        { id: "b", name: "b", api: "responses" },
      ],
    )
    expect(models.map((m) => m.api)).toEqual(["responses", "chat"])
  })

  it("keeps user edits and appends new models", () => {
    const merged = mergeDiscoveredModels(
      [
        { id: "glm-5.3", name: "My GLM", contextWindow: 500_000 },
        { id: "glm-4.6", name: "GLM-4.6" },
      ],
      [
        { id: "glm-4.6", name: "glm-4.6", contextWindow: 200_000 },
        { id: "glm-5.3", name: "glm-5.3", contextWindow: 1_000_000 },
        { id: "glm-4.5-air", name: "glm-4.5-air" },
      ],
    )
    expect(merged.added).toBe(1)
    expect(merged.models).toEqual([
      { id: "glm-5.3", name: "My GLM", contextWindow: 500_000, maxOutputTokens: undefined },
      { id: "glm-4.6", name: "GLM-4.6", contextWindow: 200_000, maxOutputTokens: undefined },
      { id: "glm-4.5-air", name: "glm-4.5-air" },
    ])
  })
})
