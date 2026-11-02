import { describe, expect, it } from "vitest"
import {
  draftFromPreset,
  draftFromProvider,
  draftToProvider,
  hasErrors,
  maskKey,
  validateDraft,
  type ProviderDraft,
} from "@/lib/config/provider-form"
import { findPreset } from "@/lib/config/provider-presets"

const zai = findPreset("zai")!

function draft(patch: Partial<ProviderDraft> = {}): ProviderDraft {
  return { ...draftFromPreset(zai, []), apiKey: "sk-1234", ...patch }
}

describe("draftFromPreset", () => {
  it("uses the catalog id and suffixes duplicates (multiple configs per provider type)", () => {
    expect(draftFromPreset(zai, []).id).toBe("zai")
    const second = draftFromPreset(zai, ["zai"])
    expect(second.id).toBe("zai-2")
    expect(second.name).toBe("Z.AI 2")
  })

  it("copies models so edits never mutate the preset", () => {
    const d = draftFromPreset(zai, [])
    d.models[0].name = "changed"
    d.models[0].capabilities!.tools = false
    expect(zai.models[0].name).toBe("GLM-5.3")
    expect(zai.models[0].capabilities!.tools).toBe(true)
  })

  it("lets the custom preset id follow the name", () => {
    expect(draftFromPreset(findPreset("custom")!, []).idFollowsName).toBe(true)
  })
})

describe("validateDraft", () => {
  const ctx = { isNew: true, takenIDs: [] as string[], requiresKey: true }

  it("accepts a complete Z.AI draft", () => {
    expect(hasErrors(validateDraft(draft(), ctx))).toBe(false)
  })

  it("requires a name, a valid unique id, and an endpoint for OpenAI-compatible", () => {
    const errors = validateDraft(draft({ name: " ", id: "Bad ID/1", baseURL: "" }), ctx)
    expect(errors.name).toBeDefined()
    expect(errors.id).toMatch(/lowercase/)
    expect(errors.baseURL).toMatch(/required/)
    expect(validateDraft(draft(), { ...ctx, takenIDs: ["zai"] }).id).toMatch(/already/)
  })

  it("rejects malformed and non-http endpoints", () => {
    expect(validateDraft(draft({ baseURL: "api.z.ai" }), ctx).baseURL).toBeDefined()
    expect(validateDraft(draft({ baseURL: "ftp://x.example" }), ctx).baseURL).toMatch(/http/)
  })

  it("allows an empty endpoint for providers with a package default", () => {
    const anthropic = { ...draftFromPreset(findPreset("anthropic")!, []), baseURL: "", apiKey: "k" }
    expect(validateDraft(anthropic, ctx).baseURL).toBeUndefined()
  })

  it("requires an API key for new hosted providers unless one is stored", () => {
    expect(validateDraft(draft({ apiKey: "" }), ctx).apiKey).toBeDefined()
    expect(validateDraft(draft({ apiKey: "" }), { ...ctx, hasStoredKey: true }).apiKey).toBeUndefined()
    expect(validateDraft(draft({ apiKey: "" }), { ...ctx, isNew: false }).apiKey).toBeUndefined()
    const ollama = draftFromPreset(findPreset("ollama")!, [])
    expect(
      validateDraft({ ...ollama, models: [{ id: "llama3", name: "" }] }, { ...ctx, requiresKey: false })
        .apiKey,
    ).toBeUndefined()
  })

  it("validates model rows", () => {
    const errors = validateDraft(
      draft({
        models: [
          { id: "", name: "" },
          { id: "a#b", name: "" },
          { id: "glm", name: "" },
          { id: "glm", name: "" },
          { id: "x", name: "", contextWindow: -5 },
        ],
      }),
      ctx,
    )
    expect(errors.modelRows).toEqual({
      0: "Model ID is required.",
      1: "Model IDs can't contain “#”.",
      3: "Duplicate model ID.",
      4: "Context window must be a positive whole number.",
    })
  })

  it("requires at least one model for endpoints without a catalog", () => {
    expect(validateDraft(draft({ models: [] }), ctx).models).toBeDefined()
  })

  it("validates headers", () => {
    expect(validateDraft(draft({ headers: [{ key: "", value: "x" }] }), ctx).headers).toBeDefined()
    expect(
      validateDraft(
        draft({
          headers: [
            { key: "X-A", value: "1" },
            { key: "x-a", value: "2" },
          ],
        }),
        ctx,
      ).headers,
    ).toMatch(/unique/)
    expect(validateDraft(draft({ headers: [{ key: "Bad Header", value: "1" }] }), ctx).headers).toBeDefined()
    expect(
      validateDraft(draft({ headers: [{ key: "X-Title", value: "Opal" }] }), ctx).headers,
    ).toBeUndefined()
  })
})

describe("draftToProvider", () => {
  it("normalizes and only carries a typed key", () => {
    const provider = draftToProvider(
      draft({
        baseURL: " https://api.z.ai/api/paas/v4/ ",
        headers: [
          { key: " X-Title ", value: "Opal" },
          { key: "", value: "" },
        ],
      }),
    )
    expect(provider.baseURL).toBe("https://api.z.ai/api/paas/v4")
    expect(provider.headers).toEqual({ "X-Title": "Opal" })
    expect(provider.apiKey).toBe("sk-1234")
    expect(draftToProvider(draft({ apiKey: "" }))).not.toHaveProperty("apiKey")
  })

  it("round-trips through draftFromProvider", () => {
    const provider = draftToProvider(draft({ apiKey: "" }))
    expect(draftToProvider(draftFromProvider(provider))).toEqual(provider)
  })
})

describe("maskKey", () => {
  it("never reveals more than the last 4 characters", () => {
    expect(maskKey("sk-abcdef123456")).toBe("••••3456")
    expect(maskKey(undefined)).toBe("")
  })
})
