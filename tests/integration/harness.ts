/**
 * Integration harness: spawns the real `opencode serve` (the bundled sidecar or ~/.opencode/bin/opencode)
 * with isolated XDG directories and a generated opencode.json, plus an in-process fake
 * OpenAI-compatible provider so generation can be tested offline and deterministically.
 *
 * Working files go to $OPAL_IT_DIR (default: <os tmpdir>/opal-it-<pid>).
 */
import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { makeClient } from "@/lib/opencode/client"
import type { OpenCodeClient } from "@/lib/opencode/types"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

export function resolveBinary(): string | undefined {
  const candidates = [
    process.env.OPENCODE_BIN,
    path.join(repoRoot, "src-tauri/binaries/opencode-aarch64-apple-darwin"),
    path.join(os.homedir(), ".opencode/bin/opencode"),
  ].filter((p): p is string => !!p)
  return candidates.find((p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK)
      return fs.statSync(p).isFile()
    } catch {
      return false
    }
  })
}

export function workRoot() {
  const root = process.env.OPAL_IT_DIR ?? path.join(os.tmpdir(), `opal-it-${process.pid}`)
  fs.mkdirSync(root, { recursive: true })
  return root
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() =>
        typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port")),
      )
    })
  })
}

// ---------- fake provider ----------

export interface RecordedRequest {
  path: string
  authorization?: string
  body: Record<string, unknown>
}

export interface FakeProvider {
  url: string
  requests: RecordedRequest[]
  /** Text the next completions return (default "OK"). */
  reply: string
  close(): Promise<void>
}

function chunk(
  model: string,
  delta: Record<string, unknown>,
  finish: string | null,
  usage?: Record<string, number>,
) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-fake",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  })}\n\n`
}

export async function startFakeProvider(): Promise<FakeProvider> {
  const fake: FakeProvider = { url: "", requests: [], reply: "OK", close: async () => undefined }
  const server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (c: Buffer) => (raw += c.toString("utf8")))
    req.on("end", () => {
      let body: Record<string, unknown> = {}
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      } catch {
        // keep empty
      }
      fake.requests.push({ path: req.url ?? "", authorization: req.headers.authorization, body })
      if (!req.url?.endsWith("/chat/completions")) {
        res.writeHead(404, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: { message: `fake provider: unsupported ${req.url}` } }))
        return
      }
      const model = typeof body.model === "string" ? body.model : "fake-model"
      const usage = { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 }
      if (body.stream) {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        })
        const words = fake.reply.split(/(?<= )/)
        res.write(chunk(model, { role: "assistant", content: "" }, null))
        for (const word of words) res.write(chunk(model, { content: word }, null))
        res.write(chunk(model, {}, "stop", usage))
        res.end("data: [DONE]\n\n")
        return
      }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          id: "chatcmpl-fake",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, message: { role: "assistant", content: fake.reply }, finish_reason: "stop" }],
          usage,
        }),
      )
    })
  })
  const port = await freePort()
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve))
  fake.url = `http://127.0.0.1:${port}/v1`
  fake.close = () => new Promise((resolve) => server.close(() => resolve()))
  return fake
}

/** opencode.json for the harness: artifacts on, the fake provider as default model. */
export function harnessConfig(fake?: FakeProvider): Record<string, unknown> {
  return {
    experimental: { artifacts: true },
    ...(fake
      ? {
          model: "fake/fake-model",
          providers: {
            fake: {
              name: "Fake",
              package: "@opencode/ai/providers/openai-compatible",
              settings: { baseURL: fake.url },
              models: { "fake-model": { name: "Fake Model", limit: { context: 32000, output: 4096 } } },
            },
          },
        }
      : {}),
  }
}

// ---------- server ----------

export interface TestServer {
  url: string
  password: string
  client: OpenCodeClient
  root: string
  /** A directory to use as a session location (an Opal-style conversation sandbox). */
  sandbox(name: string): string
  logs(): string
  stop(): Promise<void>
}

export async function startServer(config: Record<string, unknown> = harnessConfig()): Promise<TestServer> {
  const binary = resolveBinary()
  if (!binary) throw new Error("opencode binary not found (set OPENCODE_BIN)")
  const root = fs.mkdtempSync(path.join(workRoot(), "srv-"))
  const dirs = Object.fromEntries(
    ["data", "config", "cache", "state", "work"].map((d) => [d, path.join(root, d)]),
  )
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(path.join(dirs.config!, "opencode"), { recursive: true })
  fs.writeFileSync(path.join(dirs.config!, "opencode", "opencode.json"), JSON.stringify(config, null, 2))
  const port = await freePort()
  const password = randomBytes(32).toString("hex")
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(env))
    if (key.startsWith("OPENCODE_") || key.startsWith("XDG_")) delete env[key]
  Object.assign(env, {
    OPENCODE_PASSWORD: password,
    XDG_DATA_HOME: dirs.data,
    XDG_CONFIG_HOME: dirs.config,
    XDG_CACHE_HOME: dirs.cache,
    XDG_STATE_HOME: dirs.state,
  })
  let output = ""
  const child: ChildProcess = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: dirs.work,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })
  const append = (b: Buffer) => {
    output = (output + b.toString("utf8")).slice(-20_000)
  }
  child.stdout?.on("data", append)
  child.stderr?.on("data", append)
  const url = `http://127.0.0.1:${port}`
  const auth = "Basic " + Buffer.from(`opencode:${password}`).toString("base64")
  const deadline = Date.now() + 60_000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`opencode exited early (${child.exitCode}):\n${output}`)
    try {
      const res = await fetch(`${url}/api/info`, { headers: { Authorization: auth } })
      if (res.ok) break
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL")
      throw new Error(`opencode did not become ready:\n${output}`)
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  const stop = async () => {
    if (child.exitCode !== null) return
    const exited = new Promise((r) => child.once("exit", r))
    try {
      process.kill(-child.pid!, "SIGTERM")
    } catch {
      child.kill("SIGTERM")
    }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))])
    if (child.exitCode === null) child.kill("SIGKILL")
  }
  return {
    url,
    password,
    root,
    client: makeClient({ url, password }),
    sandbox(name) {
      const dir = path.join(root, "conversations", name)
      fs.mkdirSync(path.join(dir, "uploads"), { recursive: true })
      return fs.realpathSync(dir)
    },
    logs: () => output,
    stop,
  }
}

/** Collects events from one subscription until `until` matches (or the timeout passes). */
export async function collectEvents<E extends { type: string }>(
  stream: AsyncIterable<E>,
  until: (event: E, all: E[]) => boolean,
  timeoutMs = 60_000,
): Promise<E[]> {
  const events: E[] = []
  const iterator = stream[Symbol.asyncIterator]()
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      const next = await Promise.race([
        iterator.next(),
        new Promise<IteratorResult<E>>((r) =>
          setTimeout(() => r({ done: true, value: undefined }), Math.max(1, deadline - Date.now())),
        ),
      ])
      if (next.done) break
      events.push(next.value)
      if (until(next.value, events)) break
    }
  } finally {
    await iterator.return?.()
  }
  return events
}

export async function waitFor<T>(
  fn: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 30_000,
  intervalMs = 100,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await fn()
    if (value !== undefined && value !== false) return value
    if (Date.now() > deadline) throw new Error("waitFor timed out")
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}
