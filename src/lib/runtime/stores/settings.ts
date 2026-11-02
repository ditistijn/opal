/**
 * App settings (settings.json via Rust in Tauri, localStorage in the browser).
 * API keys are never persisted here — they go to OpenCode's credential store.
 */
import { useStore } from "zustand"
import { createStore } from "zustand/vanilla"
import { isTauri } from "@/lib/utils"
import type { AppSettings, ProviderConfig } from "../contracts"
import { native } from "../native"

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  maxConcurrentConnections: 3,
  defaultMode: "artifact",
  promptOverrides: {},
  providers: [],
  projects: [],
  codeSurface: { useWorktrees: true, permissionMode: "ask" },
  sidebarCollapsed: false,
  lastSurface: "chat",
  sandbox: { mode: "filesystem", allowPaths: [] },
  remote: { enabled: false, lan: true },
  updates: { autoCheck: true },
}

const SANDBOX_MODES = ["off", "filesystem", "strict"] as const

const STORAGE_KEY = "opal.settings"

interface SettingsState {
  settings: AppSettings
  loaded: boolean
}

export const settingsStore = createStore<SettingsState>(() => ({ settings: DEFAULT_SETTINGS, loaded: false }))

export function stripSecrets(provider: ProviderConfig): ProviderConfig {
  const { apiKey: _apiKey, ...rest } = provider
  return rest
}

/** Merges stored JSON over the defaults, tolerating missing / malformed fields. */
export function normalizeSettings(raw: unknown): AppSettings {
  const value = raw && typeof raw === "object" ? (raw as Partial<AppSettings>) : {}
  const max = Number(value.maxConcurrentConnections)
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    maxConcurrentConnections:
      Number.isFinite(max) && max >= 1
        ? Math.min(Math.floor(max), 32)
        : DEFAULT_SETTINGS.maxConcurrentConnections,
    promptOverrides: { ...(value.promptOverrides ?? {}) },
    providers: Array.isArray(value.providers) ? value.providers.map(stripSecrets) : [],
    projects: Array.isArray(value.projects) ? value.projects : [],
    codeSurface: { ...DEFAULT_SETTINGS.codeSurface, ...(value.codeSurface ?? {}) },
    sandbox: normalizeSandbox(value.sandbox),
    remote: {
      enabled: value.remote?.enabled === true,
      lan: value.remote?.lan !== false,
    },
    updates: { autoCheck: value.updates?.autoCheck !== false },
  }
}

function normalizeSandbox(raw: Partial<AppSettings["sandbox"]> | undefined): AppSettings["sandbox"] {
  const mode = SANDBOX_MODES.find((m) => m === raw?.mode) ?? DEFAULT_SETTINGS.sandbox.mode
  const allowPaths = Array.isArray(raw?.allowPaths)
    ? [...new Set(raw.allowPaths.filter((p): p is string => typeof p === "string" && p.startsWith("/")))]
    : []
  return { mode, allowPaths }
}

let loading: Promise<AppSettings> | undefined

export function loadSettings(): Promise<AppSettings> {
  loading ??= (async () => {
    let raw: unknown
    try {
      if (isTauri()) raw = await native.readSettings()
      else if (typeof localStorage !== "undefined")
        raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")
    } catch (error) {
      console.warn("[opal:settings] could not read settings, using defaults", String(error))
    }
    const settings = normalizeSettings(raw)
    settingsStore.setState({ settings, loaded: true })
    return settings
  })()
  return loading
}

let writeChain: Promise<void> = Promise.resolve()

async function persist(settings: AppSettings) {
  const clean = { ...settings, providers: settings.providers.map(stripSecrets) }
  if (isTauri()) await native.writeSettings(clean as unknown as Record<string, unknown>)
  else if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean))
    } catch (error) {
      console.warn("[opal:settings] could not persist settings", String(error))
    }
  }
}

/** Applies a patch (or updater) and persists; writes are serialized. */
export async function updateSettings(
  patch: Partial<AppSettings> | ((s: AppSettings) => AppSettings),
): Promise<AppSettings> {
  await loadSettings()
  const current = settingsStore.getState().settings
  const next = normalizeSettings(typeof patch === "function" ? patch(current) : { ...current, ...patch })
  settingsStore.setState({ settings: next })
  writeChain = writeChain
    .then(() => persist(next))
    .catch((error) => console.warn("[opal:settings] persist failed", String(error)))
  await writeChain
  return next
}

export function getSettings(): AppSettings {
  return settingsStore.getState().settings
}

export function useSettings(): AppSettings {
  return useStore(settingsStore, (s) => s.settings)
}
