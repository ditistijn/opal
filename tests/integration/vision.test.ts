/**
 * Image fallback end to end against the real binary: a chat on a model without image input is told to use the
 * vision helper, calls the subagent tool with agent "vision", and that child session (pinned to an image-capable
 * model by the generated opencode.json) reads the uploaded image. Both models are the scripted fake provider, so
 * the test checks what each model was actually sent.
 */
import fs from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildOpenCodeConfig } from "@/lib/config/build"
import { VISION_AGENT_ID, visionNote } from "@/lib/config/vision"
import { newSessionID } from "@/lib/opencode/ids"
import type { OpenCodeEvent } from "@/lib/opencode/types"
import { withAttachmentNote } from "@/lib/runtime/attachments"
import { normalizeSettings } from "@/lib/runtime/stores/settings"
import { collectEvents, startFakeProvider, startServer, type FakeProvider, type TestServer } from "./harness"

// 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
)
const PROMPTS = { artifact: "You are Opal.", code: "Code.", general: "General.", research: "Research." }

let server: TestServer
let fake: FakeProvider

beforeAll(async () => {
  fake = await startFakeProvider()
  const settings = normalizeSettings({
    defaultModel: { providerID: "fake", id: "blind" },
    providers: [
      {
        id: "fake",
        name: "Fake",
        type: "openai-compatible",
        baseURL: fake.url,
        enabled: true,
        models: [
          { id: "blind", name: "Blind", capabilities: { tools: true, vision: false } },
          { id: "eyes", name: "Eyes", capabilities: { tools: true, vision: true } },
        ],
      },
    ],
    imageFallback: { enabled: true, model: { providerID: "fake", id: "eyes" } },
  })
  server = await startServer(buildOpenCodeConfig({ settings, prompts: PROMPTS }))
}, 90_000)

afterAll(async () => {
  await server?.stop()
  await fake?.close()
})

type Body = { model?: string; tools?: { function: { name: string } }[]; messages?: { role: string }[] }

describe("image fallback (real binary)", () => {
  it("registers the vision agent as a subagent", async () => {
    const agents = await server.client.agent.list()
    expect(agents.data.find((a) => a.id === VISION_AGENT_ID)).toBeDefined()
  })

  it("lets a model without image input get an image read by the vision model", async () => {
    const id = newSessionID()
    const directory = server.sandbox(id)
    const image = path.join(directory, "uploads", "shot.png")
    fs.writeFileSync(image, PNG)

    fake.requests.length = 0
    fake.script = (raw) => {
      const body = raw as Body
      const tools = (body.tools ?? []).map((t) => t.function.name)
      if (!tools.length) return undefined // title generation and the like
      const answered = (body.messages ?? []).some((m) => m.role === "tool")
      if (body.model === "blind") {
        if (answered) return { text: "The image says HELLO." }
        const name = tools.find((n) => /(subagent|task)$/.test(n))
        if (!name) throw new Error(`no subagent tool in ${tools.join(", ")}`)
        return {
          toolCall: {
            name,
            arguments: {
              agent: VISION_AGENT_ID,
              description: "Read the image",
              prompt: `Transcribe ${image}`,
            },
          },
        }
      }
      if (body.model === "eyes") {
        if (answered) return { text: "It says HELLO." }
        const name = tools.find((n) => n === "read" || n === "opencode_read")
        if (!name) throw new Error(`no read tool in ${tools.join(", ")}`)
        return { toolCall: { name, arguments: { path: image } } }
      }
      return undefined
    }

    try {
      await server.client.session.create({ id, agent: "artifact", location: { directory } })
      const done = (e: OpenCodeEvent) =>
        (e.type === "session.execution.succeeded" || e.type === "session.execution.failed") &&
        e.data.sessionID === id
      const collecting = collectEvents(server.client.event.subscribe(), done, 120_000)
      await new Promise((r) => setTimeout(r, 300))
      const text = withAttachmentNote(
        "What does this say?",
        ["- uploads/shot.png (image/png, 70 B)", "", visionNote(true)],
        "The user attached these files; they are saved in your working folder:",
      )
      await server.client.session.prompt({ sessionID: id, text })
      const events = await collecting
      expect(events.at(-1)?.type, server.logs()).toBe("session.execution.succeeded")

      const chats = fake.requests.filter((r) => r.path.endsWith("/chat/completions"))
      const sent = (model: string) =>
        chats.filter((r) => r.body.model === model).map((r) => JSON.stringify(r.body))
      // The blind model never receives image data; the vision model does (from the read tool).
      expect(sent("blind").length).toBeGreaterThanOrEqual(2)
      expect(sent("blind").some((b) => b.includes("data:image/"))).toBe(false)
      expect(sent("eyes").some((b) => b.includes("data:image/png;base64"))).toBe(true)
      // The helper's answer reaches the blind model as the subagent tool result.
      expect(sent("blind").at(-1)).toContain("It says HELLO.")

      const messages = await server.client.message.list({ sessionID: id, order: "asc", limit: 50 })
      const reply = messages.data.findLast((m) => m.type === "assistant")
      expect(JSON.stringify(reply)).toContain("The image says HELLO.")
    } finally {
      fake.script = undefined
    }
  }, 150_000)
})
