/**
 * The "Responses" API choice against the real binary: a model whose `api` is "responses" must be called on
 * <baseURL>/responses (OpenCode's native openai-compatible/responses package), with the tools attached, instead
 * of /chat/completions. Some upstreams reject tools + reasoning_effort on /chat/completions, so this routing is
 * the whole fix. The fake provider answers /responses with 404, so only the request itself is checked.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildOpenCodeConfig } from "@/lib/config/build"
import { newSessionID } from "@/lib/opencode/ids"
import type { OpenCodeEvent } from "@/lib/opencode/types"
import { normalizeSettings } from "@/lib/runtime/stores/settings"
import { collectEvents, startFakeProvider, startServer, type FakeProvider, type TestServer } from "./harness"

const PROMPTS = { artifact: "You are Opal.", code: "Code.", general: "General.", research: "Research." }

let server: TestServer
let fake: FakeProvider

beforeAll(async () => {
  fake = await startFakeProvider()
  const settings = normalizeSettings({
    defaultModel: { providerID: "fake", id: "resp" },
    providers: [
      {
        id: "fake",
        name: "Fake",
        type: "openai-compatible",
        baseURL: fake.url,
        enabled: true,
        models: [{ id: "resp", name: "Resp", api: "responses", capabilities: { tools: true } }],
      },
    ],
  })
  // The Responses package refuses to run without a key (chat completions does not); normalizeSettings strips
  // keys, so add one back and write it to the config file.
  settings.providers[0].apiKey = "sk-test"
  server = await startServer(buildOpenCodeConfig({ settings, prompts: PROMPTS }, { apiKeyStorage: "file" }))
}, 90_000)

afterAll(async () => {
  await server?.stop()
  await fake?.close()
})

describe("Responses API choice (real binary)", () => {
  it("calls /responses with tools for a model set to the Responses API", async () => {
    const id = newSessionID()
    const directory = server.sandbox(id)
    fake.requests.length = 0
    await server.client.session.create({ id, agent: "artifact", location: { directory } })
    const done = (e: OpenCodeEvent) =>
      (e.type === "session.execution.succeeded" || e.type === "session.execution.failed") &&
      e.data.sessionID === id
    const collecting = collectEvents(server.client.event.subscribe(), done, 60_000)
    await new Promise((r) => setTimeout(r, 300))
    await server.client.session.prompt({ sessionID: id, text: "Hello" })
    const events = await collecting
    const outcome = JSON.stringify(events.at(-1)).slice(0, 600)

    const calls = fake.requests.filter((r) => r.body.model === "resp")
    expect(calls.length, outcome).toBeGreaterThan(0)
    expect(
      calls.every((r) => r.path.endsWith("/responses")),
      JSON.stringify(calls.map((r) => r.path)),
    ).toBe(true)
    const withTools = calls.find((r) => Array.isArray(r.body.tools) && r.body.tools.length > 0)
    expect(withTools, "no /responses request carried tools").toBeDefined()
    // Responses-API shape: `input` items, not chat `messages`.
    expect(withTools?.body.input).toBeDefined()
    expect(withTools?.body.messages).toBeUndefined()
  }, 90_000)
})
