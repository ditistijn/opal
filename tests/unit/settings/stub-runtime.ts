/**
 * Minimal stub of the Runtime contract for Settings / ModelSelector tests (and the settings dev harness).
 * Only the members those components use are implemented; everything is in memory.
 */
import { useSyncExternalStore } from "react"
import { vi } from "vitest"
import type { ModelInfo, ProviderInfo, SessionInfo } from "@/lib/opencode/types"
import type { AppSettings, Runtime, ServerStatus } from "@/lib/runtime/contracts"

export function model(
  providerID: string,
  id: string,
  name: string,
  extra: Partial<ModelInfo> = {},
): ModelInfo {
  return {
    id,
    modelID: id,
    providerID,
    name,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 128_000, output: 8_192 },
    ...extra,
  }
}

export function provider(id: string, name: string): ProviderInfo {
  return { id, name, activation: "enabled", package: "@ai-sdk/openai-compatible" }
}

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
  imageFallback: { enabled: true },
}

export interface StubState {
  settings: AppSettings
  models: ModelInfo[]
  providers: ProviderInfo[]
  sessions: Record<string, SessionInfo>
  server: ServerStatus
}

export function makeStubRuntime(initial: Partial<StubState> = {}) {
  let state: StubState = {
    settings: DEFAULT_SETTINGS,
    models: [],
    providers: [],
    sessions: {},
    server: { state: "ready", url: "http://127.0.0.1:4096", version: "2.2.5" },
    ...initial,
  }
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const use = <T>(select: (s: StubState) => T) => useSyncExternalStore(subscribe, () => select(state))
  const setState = (patch: Partial<StubState> | ((s: StubState) => Partial<StubState>)) => {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }
    listeners.forEach((listener) => listener())
  }

  const runtime = {
    useServer: () => use((s) => s.server),
    restartServer: vi.fn(async () => {}),
    useModels: () => use((s) => s.models),
    useProviders: () => use((s) => s.providers),
    useSession: (id: string | undefined) => use((s) => (id ? s.sessions[id] : undefined)),
    useSettings: () => use((s) => s.settings),
    setSessionModel: vi.fn(async (sessionID: string, ref: { providerID: string; id: string }) => {
      setState((s) => ({
        sessions: { ...s.sessions, [sessionID]: { ...s.sessions[sessionID], model: ref } },
      }))
    }),
    updateSettings: vi.fn(async (patch: Partial<AppSettings>) =>
      setState((s) => ({ settings: { ...s.settings, ...patch } })),
    ),
    saveProvider: vi.fn(async (p: AppSettings["providers"][number]) => {
      const clean = { ...p }
      delete clean.apiKey
      setState((s) => {
        const exists = s.settings.providers.some((x) => x.id === p.id)
        const providers = exists
          ? s.settings.providers.map((x) => (x.id === p.id ? clean : x))
          : [...s.settings.providers, clean]
        return { settings: { ...s.settings, providers } }
      })
    }),
    deleteProvider: vi.fn(async (id: string) =>
      setState((s) => ({
        settings: { ...s.settings, providers: s.settings.providers.filter((p) => p.id !== id) },
      })),
    ),
    testProvider: vi.fn(async () => ({ ok: true, message: "Connected", latencyMs: 231 })),
    importOpenCodeConfig: vi.fn(async () => ({ imported: 1 })),
    getPrompt: vi.fn(async () => {
      throw new Error("not available in stub")
    }),
    setPromptOverride: vi.fn(async (mode: string, text: string | undefined) =>
      setState((s) => ({
        settings: { ...s.settings, promptOverrides: { ...s.settings.promptOverrides, [mode]: text } },
      })),
    ),
    revealPath: vi.fn(async () => {}),
  }
  return Object.assign(runtime as unknown as Runtime & typeof runtime, { setState, getState: () => state })
}

export type StubRuntime = ReturnType<typeof makeStubRuntime>
