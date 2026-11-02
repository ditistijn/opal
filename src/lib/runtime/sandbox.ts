/**
 * Sandbox for agent shell commands (macOS sandbox-exec). Rust installs the wrapper shell and owns its
 * config.env (src-tauri/src/sandbox_exec.rs); settings.sandbox is the user-facing source of truth.
 *
 *  - Mode / extra folders changes are written to config.env and take effect on the next command — no restart.
 *  - opencode.json `shell` points at the wrapper whenever the mode is not "off" (build.ts `sandboxShell`), so
 *    only switching between "off" and on regenerates the config (applyConfig no-ops when nothing changed).
 */
import { useEffect } from "react"
import { useStore } from "zustand"
import { createStore } from "zustand/vanilla"
import { isTauri } from "@/lib/utils"
import type { SandboxSettings, SandboxStatus } from "./contracts"
import { native } from "./native"

interface SandboxState {
  status?: SandboxStatus
  error?: string
}

export const sandboxStore = createStore<SandboxState>(() => ({}))

/** Current wrapper status (Tauri only; undefined in the browser build). */
export async function sandboxStatus(): Promise<SandboxStatus | undefined> {
  if (!isTauri()) return undefined
  try {
    const status = await native.sandboxStatus()
    sandboxStore.setState({ status, error: undefined })
    return status
  } catch (error) {
    sandboxStore.setState({ error: String(error) })
    return undefined
  }
}

/** Writes settings.sandbox to the wrapper's config.env. */
export async function configureSandbox(sandbox: SandboxSettings): Promise<SandboxStatus | undefined> {
  if (!isTauri()) return undefined
  try {
    const status = await native.sandboxConfigure(sandbox.mode, sandbox.allowPaths)
    sandboxStore.setState({ status, error: undefined })
    return status
  } catch (error) {
    sandboxStore.setState({ error: String(error) })
    throw error
  }
}

/** The wrapper path for opencode.json, when sandbox-exec is available. */
export async function sandboxShellPath(): Promise<string | undefined> {
  const status = sandboxStore.getState().status ?? (await sandboxStatus())
  return status?.available ? status.shellPath : undefined
}

export function useSandboxStatus(): SandboxState {
  useEffect(() => {
    void sandboxStatus()
  }, [])
  return useStore(sandboxStore)
}

export const sandboxRuntime = {
  useStatus: useSandboxStatus,
  status: sandboxStatus,
}
