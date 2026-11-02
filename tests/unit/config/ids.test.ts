import { describe, expect, it } from "vitest"
import {
  formatModelRef,
  isValidProviderID,
  parseModelRef,
  PROVIDER_ID_PATTERN,
  sanitizeProviderID,
  uniqueProviderID,
} from "@/lib/config/ids"

/** Small deterministic PRNG (mulberry32) so the property tests are reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ALPHABET = "abcXYZ019 -_./#:@!?é漢字\t\n🙂"

function randomString(next: () => number) {
  const length = Math.floor(next() * 70)
  let out = ""
  for (let i = 0; i < length; i++) out += [...ALPHABET][Math.floor(next() * [...ALPHABET].length)]
  return out
}

describe("sanitizeProviderID", () => {
  it("handles common names", () => {
    expect(sanitizeProviderID("Z.AI")).toBe("z.ai")
    expect(sanitizeProviderID("My Proxy")).toBe("my-proxy")
    expect(sanitizeProviderID("  DeepSeek / Prod #2 ")).toBe("deepseek-prod-2")
    expect(sanitizeProviderID("Café Ollama")).toBe("cafe-ollama")
    expect(sanitizeProviderID("")).toBe("provider")
    expect(sanitizeProviderID("///")).toBe("provider")
  })

  it("property: always produces a valid OpenCode provider id (no '/', '#', uppercase, spaces)", () => {
    const next = rng(42)
    for (let i = 0; i < 2000; i++) {
      const id = sanitizeProviderID(randomString(next))
      expect(id).toMatch(PROVIDER_ID_PATTERN)
      expect(id).not.toMatch(/[/#A-Z\s]/)
      expect(id.length).toBeGreaterThan(0)
      expect(id.length).toBeLessThanOrEqual(48)
    }
  })

  it("property: is idempotent", () => {
    const next = rng(7)
    for (let i = 0; i < 2000; i++) {
      const once = sanitizeProviderID(randomString(next))
      expect(sanitizeProviderID(once)).toBe(once)
    }
  })

  it("property: valid ids are a fixed point", () => {
    for (const id of ["zai", "openai", "lmstudio", "zai-2", "my_proxy.v1"]) {
      expect(isValidProviderID(id)).toBe(true)
      expect(sanitizeProviderID(id)).toBe(id)
    }
  })
})

describe("uniqueProviderID", () => {
  it("appends a numeric suffix on collision", () => {
    expect(uniqueProviderID("Z.AI", [])).toBe("z.ai")
    expect(uniqueProviderID("zai", ["zai"])).toBe("zai-2")
    expect(uniqueProviderID("zai", ["zai", "zai-2"])).toBe("zai-3")
  })

  it("property: result is valid and never taken", () => {
    const next = rng(99)
    const taken: string[] = []
    for (let i = 0; i < 500; i++) {
      const id = uniqueProviderID(next() < 0.5 ? "zai" : randomString(next), taken)
      expect(isValidProviderID(id)).toBe(true)
      expect(taken).not.toContain(id)
      taken.push(id)
    }
  })

  it("keeps long ids within the length limit", () => {
    const long = "a".repeat(60)
    const first = uniqueProviderID(long, [])
    const second = uniqueProviderID(long, [first])
    expect(second.length).toBeLessThanOrEqual(48)
    expect(second.endsWith("-2")).toBe(true)
  })
})

describe("model refs", () => {
  it("round-trips provider/model#variant, allowing '/' in model ids", () => {
    expect(parseModelRef("openrouter/anthropic/claude-sonnet-4")).toEqual({
      providerID: "openrouter",
      id: "anthropic/claude-sonnet-4",
    })
    expect(parseModelRef("zai/glm-5.3#high")).toEqual({ providerID: "zai", id: "glm-5.3", variant: "high" })
    expect(formatModelRef({ providerID: "zai", id: "glm-5.3", variant: "high" })).toBe("zai/glm-5.3#high")
    expect(parseModelRef("nope")).toBeUndefined()
    expect(parseModelRef("/x")).toBeUndefined()
    expect(parseModelRef("a/b#")).toBeUndefined()
  })
})
