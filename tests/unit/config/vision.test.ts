import { describe, expect, it } from "vitest"
import { buildOpenCodeConfig } from "@/lib/config/build"
import {
  looksLikeImage,
  modelSeesImages,
  pickVisionModel,
  VISION_AGENT_ID,
  visionAgentModel,
  visionModels,
  visionNote,
} from "@/lib/config/vision"
import { normalizeSettings } from "@/lib/runtime/stores/settings"
import { model } from "../settings/stub-runtime"
import { fixtureSettings, PROMPTS } from "./fixtures"

const VISION = { capabilities: { tools: true, input: ["text", "image"], output: ["text"] } }

const CATALOG = [
  model("zai", "glm-5.3", "GLM-5.3"),
  model("openrouter", "gpt-vision", "GPT Vision", VISION),
  model("zai", "glm-4.5v", "GLM-4.5V", VISION),
  model("zai", "glm-5v-off", "Disabled vision", { ...VISION, enabled: false }),
  model("zai", "img-gen", "Image gen", { ...VISION, type: "image" as never }),
  model("ollama", "llava", "LLaVA", {
    capabilities: { tools: false, input: ["text", "image"], output: ["text"] },
  }),
]

describe("vision helpers", () => {
  it("lists enabled, tool-capable chat models with image input", () => {
    expect(visionModels(CATALOG).map((m) => m.id)).toEqual(["gpt-vision", "glm-4.5v"])
  })

  it("prefers a vision model of the default model's provider", () => {
    expect(pickVisionModel(CATALOG, undefined, { providerID: "zai", id: "glm-5.3" })).toEqual({
      providerID: "zai",
      id: "glm-4.5v",
    })
    expect(pickVisionModel(CATALOG, undefined, undefined)).toEqual({
      providerID: "openrouter",
      id: "gpt-vision",
    })
  })

  it("keeps a still-valid choice and replaces one that lost image input or disappeared", () => {
    const chosen = { providerID: "openrouter", id: "gpt-vision" }
    expect(pickVisionModel(CATALOG, chosen, { providerID: "zai", id: "glm-5.3" })).toBe(chosen)
    expect(pickVisionModel(CATALOG, { providerID: "zai", id: "glm-5.3" }, undefined)?.id).toBe("gpt-vision")
    expect(pickVisionModel(CATALOG, { providerID: "gone", id: "x" }, undefined)?.id).toBe("gpt-vision")
    expect(pickVisionModel([model("zai", "glm-5.3", "GLM-5.3")], undefined, undefined)).toBeUndefined()
  })

  it("knows which models see images; unknown models are assumed to", () => {
    expect(modelSeesImages(CATALOG, { providerID: "zai", id: "glm-5.3" })).toBe(false)
    expect(modelSeesImages(CATALOG, { providerID: "zai", id: "glm-4.5v" })).toBe(true)
    expect(modelSeesImages(CATALOG, { providerID: "nope", id: "x" })).toBe(true)
    expect(modelSeesImages(CATALOG, undefined)).toBe(true)
  })

  it("recognizes raster images by mime or extension", () => {
    expect(looksLikeImage({ name: "a.bin", mime: "image/png" })).toBe(true)
    expect(looksLikeImage({ name: "a.svg", mime: "image/svg+xml" })).toBe(false)
    expect(looksLikeImage({ name: "Screenshot.JPEG" })).toBe(true)
    expect(looksLikeImage({ name: "report.pdf" })).toBe(false)
  })

  it("tells the model how to call the helper, or to explain it can't see images", () => {
    expect(visionNote(true)).toContain(`agent "${VISION_AGENT_ID}"`)
    expect(visionNote(false)).toContain("cannot view images")
  })
})

describe("vision agent in opencode.json", () => {
  const withFallback = (imageFallback: { enabled: boolean; model?: { providerID: string; id: string } }) =>
    fixtureSettings({ imageFallback })

  it("adds a read-only subagent pinned to the fallback model", () => {
    const config = buildOpenCodeConfig({
      settings: withFallback({ enabled: true, model: { providerID: "zai", id: "glm-4.5v" } }),
      prompts: PROMPTS,
    })
    const agent = config.agents[VISION_AGENT_ID]
    expect(agent?.model).toBe("zai/glm-4.5v")
    expect(agent?.mode).toBe("subagent")
    expect(agent?.permissions).toEqual(
      expect.arrayContaining([
        { action: "edit", resource: "*", effect: "deny" },
        { action: "shell", resource: "*", effect: "deny" },
      ]),
    )
    // The uploads allow comes after the blanket ask (the last matching rule wins).
    const external = agent!.permissions.filter((r) => r.action === "external_directory")
    expect(external.at(-1)).toEqual({
      action: "external_directory",
      resource: "*/conversations/*/uploads/*",
      effect: "allow",
    })
  })

  it("omits the agent when the fallback is off, unset, or its provider is disabled", () => {
    const build = (settings: ReturnType<typeof fixtureSettings>) =>
      buildOpenCodeConfig({ settings, prompts: PROMPTS }).agents[VISION_AGENT_ID]
    expect(
      build(withFallback({ enabled: false, model: { providerID: "zai", id: "glm-4.5v" } })),
    ).toBeUndefined()
    expect(build(withFallback({ enabled: true }))).toBeUndefined()
    // The fixture's OpenRouter provider is disabled.
    expect(
      visionAgentModel(
        withFallback({ enabled: true, model: { providerID: "openrouter", id: "x/y" } }),
        new Set(["openrouter"]),
      ),
    ).toBeUndefined()
  })

  it("normalizes stored settings (on by default, malformed models dropped)", () => {
    expect(normalizeSettings({}).imageFallback).toEqual({ enabled: true })
    expect(normalizeSettings({ imageFallback: { enabled: false } }).imageFallback).toEqual({ enabled: false })
    expect(
      normalizeSettings({ imageFallback: { enabled: true, model: { providerID: 3 } } }).imageFallback,
    ).toEqual({
      enabled: true,
    })
    expect(
      normalizeSettings({ imageFallback: { model: { providerID: "zai", id: "glm-4.5v", junk: 1 } } })
        .imageFallback,
    ).toEqual({ enabled: true, model: { providerID: "zai", id: "glm-4.5v" } })
  })
})
