/**
 * Connection to the OpenCode server.
 *
 * Tauri: the Rust sidecar supervisor owns the server; we read the connection via
 * `cmd_server_connection` and follow `server:status` events (restarts produce a new URL/password,
 * so the client is rebuilt on every "ready").
 * Browser (dev/e2e): VITE_OPENCODE_URL / VITE_OPENCODE_PASSWORD, overridable with localStorage
 * `opal.server.url` / `opal.server.password`. A remote-control pairing link (`#rc=…`, ./remote-pairing.ts)
 * is redeemed first and fills those localStorage keys with the device's session token.
 *
 * The password is only kept in memory (and in the Authorization header); it is never logged.
 */
import { OpenCode } from "@opencode/client/promise"
import { createStore } from "zustand/vanilla"
import type { ServerStatus } from "@/lib/runtime/contracts"
import { isTauri } from "@/lib/utils"
import { consumePairingLink, isPairedDevice } from "./remote-pairing"
import type { OpenCodeClient } from "./types"

export interface ServerConnection {
  url: string
  password: string
  version?: string | null
}

interface ServerState {
  status: ServerStatus
  /** Increments every time a new client is built (restart / reconnect to a new sidecar). */
  epoch: number
}

export const serverStore = createStore<ServerState>(() => ({
  status: { state: "starting", message: "Starting…" },
  epoch: 0,
}))

let client: OpenCodeClient | undefined
let waiters: Array<(c: OpenCodeClient) => void> = []
let started = false

// The client's shared event stream uses Promise.withResolvers (Safari 17.4+); macOS 12/13 WebKit lacks it.
if (typeof (Promise as { withResolvers?: unknown }).withResolvers !== "function") {
  Object.defineProperty(Promise, "withResolvers", {
    configurable: true,
    writable: true,
    value: function withResolvers<T>() {
      let resolve!: (value: T | PromiseLike<T>) => void
      let reject!: (reason?: unknown) => void
      const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    },
  })
}

/** Browser build without a configured server (e.g. a phone that has not been paired yet). */
export const NO_SERVER_MESSAGE =
  "No OpenCode server configured. Set VITE_OPENCODE_URL (and VITE_OPENCODE_PASSWORD) or run the desktop app."

export function basicAuth(password: string) {
  return "Basic " + btoa(`opencode:${password}`)
}

export function makeClient(conn: ServerConnection): OpenCodeClient {
  return OpenCode.make({
    baseUrl: conn.url.replace(/\/$/, ""),
    headers: { Authorization: basicAuth(conn.password) },
  })
}

function setReady(conn: ServerConnection) {
  client = makeClient(conn)
  serverStore.setState((s) => ({
    status: { state: "ready", url: conn.url, version: conn.version ?? undefined },
    epoch: s.epoch + 1,
  }))
  console.debug(`[opal:server] ready ${conn.url}`)
  const pending = waiters
  waiters = []
  pending.forEach((resolve) => resolve(client!))
}

function setStatus(status: ServerStatus) {
  serverStore.setState({ status })
  console.debug(
    `[opal:server] ${status.state}${"message" in status && status.message ? `: ${status.message}` : ""}`,
  )
}

function readLocal(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

/** Resolves the browser-mode server from localStorage overrides or Vite env. */
export function browserConnection(): ServerConnection | undefined {
  const env = import.meta.env as Record<string, string | undefined>
  const url = readLocal("opal.server.url") ?? env.VITE_OPENCODE_URL
  const password = readLocal("opal.server.password") ?? env.VITE_OPENCODE_PASSWORD ?? ""
  return url ? { url, password } : undefined
}

async function connectTauri() {
  const { invoke } = await import("@tauri-apps/api/core")
  const { listen } = await import("@tauri-apps/api/event")
  // Listen first so a "ready" emitted between the two calls is not missed.
  await listen<ServerStatus>("server:status", async (event) => {
    const status = event.payload
    if (status.state !== "ready") return setStatus(status)
    const conn = await invoke<ServerConnection | null>("cmd_server_connection")
    if (conn) setReady(conn)
  })
  const conn = await invoke<ServerConnection | null>("cmd_server_connection")
  if (conn) setReady(conn)
}

async function connectBrowser() {
  const pairingError = await consumePairingLink()
  if (pairingError) return setStatus({ state: "error", message: pairingError })
  const conn = browserConnection()
  if (!conn) {
    setStatus({ state: "error", message: NO_SERVER_MESSAGE })
    return
  }
  // Poll until the server answers so a dev server started after the page still connects.
  const probe = makeClient(conn)
  for (let attempt = 0; ; attempt++) {
    try {
      const info = await probe.server.info()
      return setReady({ ...conn, version: info.version })
    } catch (error) {
      if (attempt === 0) setStatus({ state: "starting", message: `Connecting to ${conn.url}…` })
      if (attempt === 20)
        setStatus({
          state: "error",
          message: isPairedDevice()
            ? `Cannot reach Opal at ${conn.url}. Is the Mac awake, on the same network, with remote control on? If it was turned off and on again, pair this device again. (${String(error)})`
            : `Cannot reach OpenCode at ${conn.url}: ${String(error)}`,
        })
      await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** Math.min(attempt, 4), 5000)))
    }
  }
}

/** Starts resolving the server (idempotent). */
export function connect(): void {
  if (started) return
  started = true
  const run = isTauri() ? connectTauri : connectBrowser
  run().catch((error) => setStatus({ state: "error", message: String(error) }))
}

/** For tests / integration: use an explicit connection instead of Tauri or env. */
export function connectTo(conn: ServerConnection): OpenCodeClient {
  started = true
  setReady(conn)
  return client!
}

export function getClient(): OpenCodeClient {
  if (!client) throw new Error("OpenCode server is not ready yet")
  return client
}

export function peekClient(): OpenCodeClient | undefined {
  return client
}

export function whenReady(): Promise<OpenCodeClient> {
  if (client) return Promise.resolve(client)
  connect()
  return new Promise((resolve) => waiters.push(resolve))
}

export async function restartServer(): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core")
    client = undefined
    setStatus({ state: "starting", message: "Restarting engine…" })
    await invoke("cmd_server_restart")
    return
  }
  started = false
  client = undefined
  connect()
}
