import { describe, expect, it, vi } from "vitest"
import {
  decodeRemotePayload,
  encodeRemotePayload,
  engineURLFor,
  pairingLinks,
  redeemPairing,
} from "@/lib/opencode/remote-pairing"

describe("remote pairing links", () => {
  it("round-trips the payload through a URL-safe fragment", () => {
    const payload = {
      url: "http://192.168.1.20:47801",
      code: "a-b_c",
      conversations: "/Users/é/Opal/conversations",
    }
    const encoded = encodeRemotePayload(payload)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeRemotePayload(`#rc=${encoded}`)).toEqual(payload)
  })

  it("rejects malformed or non-http payloads", () => {
    expect(decodeRemotePayload("#nothing")).toBeUndefined()
    expect(decodeRemotePayload("#rc=!!!")).toBeUndefined()
    expect(
      decodeRemotePayload(`#rc=${encodeRemotePayload({ url: "javascript:alert(1)", code: "x" })}`),
    ).toBeUndefined()
    expect(decodeRemotePayload(`#rc=${btoa(JSON.stringify({ url: "http://x" }))}`)).toBeUndefined()
  })

  it("normalizes the server URL to its origin", () => {
    const encoded = encodeRemotePayload({ url: "http://10.0.0.2:47801/some/path", code: "c" })
    expect(decodeRemotePayload(`#rc=${encoded}`)?.url).toBe("http://10.0.0.2:47801")
  })

  it("reaches the engine through the host the page was loaded from", () => {
    expect(engineURLFor("http://192.168.1.20:47801", "100.101.102.103")).toBe("http://100.101.102.103:47801")
    expect(engineURLFor("http://192.168.1.20:47801", "localhost")).toBe("http://localhost:47801")
    expect(engineURLFor("http://192.168.1.20:47801", undefined)).toBe("http://192.168.1.20:47801")
  })

  it("builds the Opal and OpenCode links", () => {
    const links = pairingLinks({
      webURL: "http://10.0.0.2:47800/",
      sidecarURL: "http://10.0.0.2:47801",
      code: "k/1",
    })
    expect(links.link.startsWith("http://10.0.0.2:47800/#rc=")).toBe(true)
    expect(decodeRemotePayload(links.link.slice(links.link.indexOf("#")))).toEqual({
      url: "http://10.0.0.2:47801",
      code: "k/1",
    })
    expect(links.openCodeLink).toBe("http://10.0.0.2:47801/auth/connect/k%2F1")
  })

  it("redeems a code as JSON and reports expired codes", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ token: "123.sig" }), { status: 200 }))
    await expect(
      redeemPairing({ url: "http://h:1", code: "c" }, ok as unknown as typeof fetch),
    ).resolves.toBe("123.sig")
    expect(ok).toHaveBeenCalledWith("http://h:1/auth/connect/c", { headers: { Accept: "application/json" } })
    const gone = vi.fn(async () => new Response("{}", { status: 401 }))
    await expect(
      redeemPairing({ url: "http://h:1", code: "c" }, gone as unknown as typeof fetch),
    ).rejects.toThrow(/expired/)
  })
})
