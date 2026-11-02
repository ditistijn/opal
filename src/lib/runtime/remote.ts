/**
 * Remote control: continue Opal sessions from a phone or another computer.
 *
 * Rust (src-tauri/src/remote_web.rs) owns the network side: it rebinds the sidecar to 0.0.0.0 on a stable port
 * with a persisted password and `--cors` for the web UI origins, and serves the Opal web UI on the LAN.
 * This module mirrors settings.remote into Rust (`cmd_remote_configure`, which restarts the sidecar when the
 * binding changes) and issues one-time pairing links through OpenCode's `POST /api/pair`.
 */
import { useEffect } from "react"
import { useStore } from "zustand"
import { createStore } from "zustand/vanilla"
import { serverStore, whenReady } from "@/lib/opencode/client"
import { pairingLinks } from "@/lib/opencode/remote-pairing"
import { isTauri } from "@/lib/utils"
import type { RemotePairing, RemoteSettings, RemoteStatus } from "./contracts"
import { native } from "./native"
import { getSettings, updateSettings } from "./stores/settings"

interface RemoteState {
  status?: RemoteStatus
  error?: string
  busy: boolean
}

export const remoteStore = createStore<RemoteState>(() => ({ busy: false }))

async function refresh(): Promise<RemoteStatus | undefined> {
  if (!isTauri()) return undefined
  try {
    const status = await native.remoteStatus()
    remoteStore.setState({ status, error: undefined })
    return status
  } catch (error) {
    remoteStore.setState({ error: String(error) })
    return undefined
  }
}

/** Mirrors settings.remote into Rust; Rust restarts the sidecar only when its binding changes. */
export async function syncRemote(remote: RemoteSettings): Promise<RemoteStatus | undefined> {
  if (!isTauri()) return undefined
  remoteStore.setState({ busy: true })
  try {
    const status = await native.remoteConfigure(remote.enabled, remote.lan)
    remoteStore.setState({ status, error: undefined })
    return status
  } catch (error) {
    remoteStore.setState({ error: String(error) })
    return undefined
  } finally {
    remoteStore.setState({ busy: false })
  }
}

let conversationsDir: string | undefined

async function conversations(): Promise<string | undefined> {
  if (!isTauri()) return undefined
  if (conversationsDir) return conversationsDir
  const { invoke } = await import("@tauri-apps/api/core")
  const paths = await invoke<{ conversations_dir: string }>("cmd_paths").catch(() => undefined)
  conversationsDir = paths?.conversations_dir
  return conversationsDir
}

/** Waits until the restarted sidecar reports its LAN URL (after enabling, the engine restarts). */
async function readyStatus(timeoutMs = 30_000): Promise<RemoteStatus> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const status = await refresh()
    if (status?.enabled && status.sidecarURL && status.webURL) return status
    if (Date.now() > deadline) {
      if (!status?.enabled) throw new Error("Remote control is off.")
      if (!status.lanIPs.length && status.lan)
        throw new Error("This Mac has no network address. Connect to Wi-Fi.")
      throw new Error("The engine is not ready for remote connections yet.")
    }
    await new Promise((r) => setTimeout(r, 500))
  }
}

/** A fresh one-time pairing link (single use, expires after ~5 minutes). */
export async function pair(): Promise<RemotePairing> {
  const status = await readyStatus()
  // Right after enabling, the webview client may still point at the previous sidecar: wait for the new one.
  const deadline = Date.now() + 30_000
  for (;;) {
    const server = serverStore.getState().status
    if (server.state === "ready" && server.url.endsWith(`:${status.sidecarPort}`)) break
    if (Date.now() > deadline) throw new Error("The engine is restarting; try again in a moment.")
    await new Promise((r) => setTimeout(r, 250))
  }
  const client = await whenReady()
  const { code, expires_in } = await client.server.pair()
  const links = pairingLinks({
    webURL: status.webURL!,
    sidecarURL: status.sidecarURL!,
    code,
    conversations: await conversations(),
  })
  return { code, expiresAt: Date.now() + expires_in * 1000, ...links }
}

export async function setRemote(patch: Partial<RemoteSettings>) {
  const next = await updateSettings((s) => ({ ...s, remote: { ...s.remote, ...patch } }))
  return syncRemote(next.remote)
}

/** Rotates the server secret: every paired device must pair again. */
export async function revokeAll(): Promise<void> {
  if (!isTauri()) return
  remoteStore.setState({ busy: true })
  try {
    remoteStore.setState({ status: await native.remoteRevoke(), error: undefined })
  } finally {
    remoteStore.setState({ busy: false })
  }
}

/** Live status while a component is mounted (polled; network addresses can change). */
export function useRemoteStatus(): RemoteState {
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 4000)
    return () => clearInterval(timer)
  }, [])
  return useStore(remoteStore)
}

export const remoteRuntime = {
  /** Remote control needs the desktop app (Rust owns the network side). */
  available: isTauri,
  useStatus: useRemoteStatus,
  refresh,
  enable: (lan = getSettings().remote.lan) => setRemote({ enabled: true, lan }),
  disable: () => setRemote({ enabled: false }),
  setLan: (lan: boolean) => setRemote({ lan }),
  pair,
  revokeAll,
}
