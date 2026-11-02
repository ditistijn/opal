/**
 * Verifies the OpenCode 2.2.5 API facts the runtime depends on, against the real binary.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { newSessionID } from "@/lib/opencode/ids"
import type { OpenCodeEvent } from "@/lib/opencode/types"
import { applyEvents, emptyProjection, projectionFromList } from "@/lib/runtime/projection"
import { getOpalMetadata } from "@/lib/runtime/stores/sessions"
import {
  collectEvents,
  harnessConfig,
  startFakeProvider,
  startServer,
  type FakeProvider,
  type TestServer,
} from "./harness"

let server: TestServer
let fake: FakeProvider

beforeAll(async () => {
  fake = await startFakeProvider()
  server = await startServer(harnessConfig(fake))
})

afterAll(async () => {
  await server?.stop()
  await fake?.close()
})

const idle = (sessionID: string) => (e: OpenCodeEvent) =>
  (e.type === "session.execution.succeeded" || e.type === "session.execution.failed") &&
  e.data.sessionID === sessionID

describe("OpenCode server (real binary)", () => {
  it("boots and answers /api/info with Basic auth only", async () => {
    const info = await server.client.server.info()
    expect(info.version).toMatch(/^2\./)
    const unauth = await fetch(`${server.url}/api/info`)
    expect(unauth.status).toBe(401)
  })

  it("creates a session with a client-generated id, location and Opal metadata", async () => {
    const id = newSessionID()
    const directory = server.sandbox(id)
    const created = await server.client.session.create({
      id,
      title: "Integration",
      location: { directory },
      metadata: { opal: { surface: "chat", mode: "artifact", directory } },
    })
    expect(created.id).toBe(id)
    expect(created.location.directory).toBe(directory)
    const fetched = await server.client.session.get({ sessionID: id })
    expect(getOpalMetadata(fetched)).toMatchObject({ surface: "chat", mode: "artifact", directory })
    const list = await server.client.session.list({ limit: 100 })
    expect(list.data.some((s) => s.id === id)).toBe(true)
  })

  it("stores per-session instruction entries", async () => {
    const id = newSessionID()
    await server.client.session.create({ id, location: { directory: server.sandbox(id) } })
    await server.client.experimental.session.instructions.entry.put({
      sessionID: id,
      key: "opal-sandbox",
      value: "Working folder: /x",
    })
    const entries = await server.client.experimental.session.instructions.entry.list({ sessionID: id })
    expect(entries).toEqual([{ key: "opal-sandbox", value: "Working folder: /x" }])
  })

  it("creates, lists, reads and updates artifacts through the API", async () => {
    const id = newSessionID()
    const directory = server.sandbox(id)
    await server.client.session.create({ id, location: { directory } })
    const created = await server.client.experimental.artifacts.create({
      sessionID: id,
      title: "Hello",
      files: { "index.html": "<h1>Hello</h1>" },
    })
    expect(created.data).toMatchObject({ title: "Hello", entry: "index.html", sessionID: id })
    const list = await server.client.experimental.artifacts.list({ sessionID: id })
    expect(list.data.map((a) => a.id)).toEqual([created.data.id])
    // Records are scoped to the location's project, so get/update pass the session's directory.
    const got = await server.client.experimental.artifacts.get({
      artifactID: created.data.id,
      location: { directory },
    })
    expect(got.data.files).toEqual({ "index.html": "<h1>Hello</h1>" })
    await new Promise((r) => setTimeout(r, 5))
    const updated = await server.client.experimental.artifacts.update({
      artifactID: created.data.id,
      sessionID: id,
      location: { directory },
      files: { "index.html": "<h1>Bye</h1>" },
    })
    expect(updated.data.time.updated).toBeGreaterThan(created.data.time.updated)
  })

  it("delivers session.created on the shared event stream", async () => {
    const id = newSessionID()
    const stream = server.client.event.subscribe({ types: ["session.created"] })
    const collecting = collectEvents(
      stream,
      (e) => e.type === "session.created" && e.data.sessionID === id,
      15_000,
    )
    await new Promise((r) => setTimeout(r, 300))
    await server.client.session.create({
      id,
      location: { directory: server.sandbox(id) },
      metadata: { opal: { surface: "chat" } },
    })
    const events = await collecting
    expect(events[0]?.type).toBe("server.connected")
    const created = events.find((e) => e.type === "session.created")
    expect(created && "data" in created && created.data).toMatchObject({
      sessionID: id,
      metadata: { opal: { surface: "chat" } },
    })
  })

  it("streams a prompt: live projection equals the persisted message list", async () => {
    fake.reply = "Hello from the fake provider."
    const id = newSessionID()
    await server.client.session.create({ id, location: { directory: server.sandbox(id) } })
    const stream = server.client.event.subscribe()
    const collecting = collectEvents(stream, idle(id), 60_000)
    await new Promise((r) => setTimeout(r, 300))
    await server.client.session.prompt({
      sessionID: id,
      text: "Say hello",
      metadata: { opal: { text: "Say hello" } },
    })
    const events = (await collecting).filter(
      (e) => "data" in e && (e.data as { sessionID?: string }).sessionID === id,
    )
    expect(events.some((e) => e.type === "session.text.delta")).toBe(true)
    const live = applyEvents(emptyProjection(), id, events)
    const persisted = await server.client.message.list({ sessionID: id, order: "asc", limit: 200 })
    const loaded = projectionFromList(persisted.data, id)
    const shape = (p: typeof live) =>
      p.messages.map((m) => ({
        id: m.id,
        role: m.role,
        parts: m.parts.map((x) => ("text" in x ? x.text : x.type)),
      }))
    expect(shape(live)).toEqual(shape(loaded))
    expect(shape(live)).toEqual([
      { id: expect.any(String), role: "user", parts: ["Say hello"] },
      { id: expect.any(String), role: "assistant", parts: ["Hello from the fake provider."] },
    ])
  })

  it("applies a key credential (integrationID = provider id) as the provider's apiKey", async () => {
    const key = "sk-opal-it-" + Math.random().toString(36).slice(2)
    const credential = await server.client.credential.create({
      integrationID: "fake",
      label: "Opal",
      value: { type: "key", key },
      activate: true,
    })
    try {
      fake.requests.length = 0
      fake.reply = "OK"
      const result = await server.client.experimental.generate.text({
        prompt: "Say OK",
        model: { providerID: "fake", id: "fake-model" },
      })
      expect(result.text.trim()).toBe("OK")
      const sent = fake.requests.find((r) => r.path.endsWith("/chat/completions"))
      expect(sent?.authorization).toBe(`Bearer ${key}`)
    } finally {
      await server.client.credential.remove({ credentialID: credential.id })
    }
  })

  it("reverts a turn with revert.stage + revert.commit", async () => {
    fake.reply = "First answer."
    const id = newSessionID()
    await server.client.session.create({ id, location: { directory: server.sandbox(id) } })
    const collecting = collectEvents(server.client.event.subscribe(), idle(id), 60_000)
    await new Promise((r) => setTimeout(r, 300))
    const admitted = await server.client.session.prompt({ sessionID: id, text: "one" })
    await collecting
    const before = await server.client.message.list({ sessionID: id, order: "asc" })
    expect(before.data.some((m) => m.type === "assistant")).toBe(true)
    await server.client.session.revert.stage({ sessionID: id, messageID: admitted.id })
    await server.client.session.revert.commit({ sessionID: id })
    const after = await server.client.message.list({ sessionID: id, order: "asc" })
    expect(after.data.filter((m) => m.id >= admitted.id)).toEqual([])
  })
})
