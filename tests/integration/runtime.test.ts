/**
 * Drives the real runtime (stores, event loop, limiter, artifacts) against the real binary in
 * browser mode (no Tauri), with the fake provider for deterministic replies.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { connectTo } from "@/lib/opencode/client"
import type { TextPart } from "@/lib/runtime/contracts"
import { startEventLoop } from "@/lib/runtime/events"
import * as api from "@/lib/runtime/sessions-api"
import { activityStore, getActivity } from "@/lib/runtime/stores/activity"
import { artifactsStore, loadArtifacts } from "@/lib/runtime/stores/artifacts"
import { catalogStore, refreshCatalog } from "@/lib/runtime/stores/catalog"
import { ensureMessages, flushMessages, getMessages } from "@/lib/runtime/stores/messages"
import { sessionsStore } from "@/lib/runtime/stores/sessions"
import { updateSettings } from "@/lib/runtime/stores/settings"
import {
  harnessConfig,
  startFakeProvider,
  startServer,
  waitFor,
  type FakeProvider,
  type TestServer,
} from "./harness"

let server: TestServer
let fake: FakeProvider

beforeAll(async () => {
  fake = await startFakeProvider()
  server = await startServer(harnessConfig(fake))
  connectTo({ url: server.url, password: server.password })
  startEventLoop()
  await waitFor(() => sessionsStore.getState().loaded || undefined, 20_000)
})

afterAll(async () => {
  await server?.stop()
  await fake?.close()
})

function lastAssistantText(sessionID: string) {
  flushMessages()
  const last = getMessages(sessionID).findLast((m) => m.role === "assistant" && !m.streaming)
  return last?.parts.map((p) => (p as TextPart).text ?? "").join("")
}

describe("runtime against the real server", () => {
  it("loads the catalog", async () => {
    await refreshCatalog()
    const { models, providers } = catalogStore.getState()
    expect(providers.some((p) => p.id === "fake")).toBe(true)
    expect(models.some((m) => m.providerID === "fake" && m.id === "fake-model")).toBe(true)
  })

  it("creates a session, sends a prompt and projects the streamed reply", async () => {
    fake.reply = "Projected through the runtime."
    const session = await api.createSession({
      surface: "chat",
      title: "Runtime",
      directory: server.sandbox("rt-1"),
    })
    expect(sessionsStore.getState().byID[session.id]).toBeDefined()
    ensureMessages(session.id)
    await waitFor(() => getMessages(session.id) && true)
    await api.sendPrompt(session.id, { text: "Hi there" })
    const text = await waitFor(
      () => (getActivity(session.id) === "idle" ? lastAssistantText(session.id) : undefined),
      60_000,
    )
    expect(text).toBe("Projected through the runtime.")
    const messages = getMessages(session.id)
    expect(messages[0]).toMatchObject({ role: "user", parts: [{ type: "text", text: "Hi there" }] })
    const entries = await server.client.experimental.session.instructions.entry.list({
      sessionID: session.id,
    })
    expect(entries.map((e) => e.key)).toContain("opal-sandbox")
  })

  it("queues prompts beyond the concurrency limit", async () => {
    await updateSettings({ maxConcurrentConnections: 1 })
    try {
      fake.reply = "done"
      const a = await api.createSession({ surface: "chat", directory: server.sandbox("rt-a") })
      const b = await api.createSession({ surface: "chat", directory: server.sandbox("rt-b") })
      ensureMessages(b.id)
      let bQueued = false
      const unsubscribe = activityStore.subscribe(() => {
        if (getActivity(b.id) === "queued") bQueued = true
      })
      try {
        // sendPrompt resolves once the server admits the prompt, so b's promise waits for a's slot.
        await api.sendPrompt(a.id, { text: "a" })
        const second = api.sendPrompt(b.id, { text: "b" })
        await waitFor(() => bQueued || getActivity(a.id) === "idle" || undefined, 10_000)
        await second
        await waitFor(
          () =>
            (getActivity(a.id) === "idle" &&
              getActivity(b.id) === "idle" &&
              lastAssistantText(b.id) === "done") ||
            undefined,
          60_000,
        )
      } finally {
        unsubscribe()
      }
      expect(bQueued).toBe(true)
    } finally {
      await updateSettings({ maxConcurrentConnections: 3 })
    }
  })

  it("renames, stars and archives sessions", async () => {
    const s = await api.createSession({ surface: "chat", directory: server.sandbox("rt-meta") })
    await api.renameSession(s.id, "Renamed")
    await api.starSession(s.id, true)
    await api.archiveSession(s.id, true)
    const fetched = await server.client.session.get({ sessionID: s.id })
    expect(fetched.title).toBe("Renamed")
    expect((fetched.metadata?.opal as { starred?: boolean }).starred).toBe(true)
    expect(fetched.time.archived).toBeTypeOf("number")
  })

  it("regenerates the last answer", async () => {
    fake.reply = "first"
    const s = await api.createSession({ surface: "chat", directory: server.sandbox("rt-regen") })
    ensureMessages(s.id)
    await api.sendPrompt(s.id, { text: "question" })
    await waitFor(
      () => (getActivity(s.id) === "idle" && lastAssistantText(s.id) === "first") || undefined,
      60_000,
    )
    fake.reply = "second"
    await api.regenerate(s.id)
    await waitFor(
      () => (getActivity(s.id) === "idle" && lastAssistantText(s.id) === "second") || undefined,
      60_000,
    )
    const list = await server.client.message.list({ sessionID: s.id, order: "asc" })
    expect(list.data.filter((m) => m.type === "user").map((m) => m.type === "user" && m.text)).toEqual([
      "question",
    ])
  })

  it("tracks artifacts with in-memory versions in browser mode", async () => {
    const directory = server.sandbox("rt-art")
    const s = await api.createSession({ surface: "chat", directory })
    await loadArtifacts(s.id)
    const created = await server.client.experimental.artifacts.create({
      sessionID: s.id,
      title: "Chart",
      files: { "index.html": "<p>1</p>" },
    })
    await loadArtifacts(s.id, true)
    const state = artifactsStore.getState()
    expect(state.bySession[s.id]?.map((a) => a.id)).toEqual([created.data.id])
    expect(state.active[s.id]).toBe(created.data.id)
    const view = state.views[created.data.id]!
    expect(view.kind).toBe("html")
    expect(view.versions.map((v) => v.n)).toEqual([1])
  })
})
