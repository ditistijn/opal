/** Models / providers / agents catalog, refreshed when the server reports catalog changes. */
import { useStore } from "zustand"
import { createStore } from "zustand/vanilla"
import { whenReady } from "@/lib/opencode/client"
import type { AgentInfo, ModelInfo, OpenCodeEvent, ProviderInfo } from "@/lib/opencode/types"
import { getSettings, updateSettings } from "./settings"

interface CatalogState {
  models: ModelInfo[]
  providers: ProviderInfo[]
  agents: AgentInfo[]
  loaded: boolean
}

export const catalogStore = createStore<CatalogState>(() => ({
  models: [],
  providers: [],
  agents: [],
  loaded: false,
}))

const REFRESH_EVENTS = new Set([
  "provider.updated",
  "model.updated",
  "agent.updated",
  "config.updated",
  "integration.updated",
  "credential.updated",
  "credential.switched",
  "models-dev.refreshed",
])

let inflight: Promise<void> | undefined
let again = false

export function refreshCatalog(): Promise<void> {
  if (inflight) {
    again = true
    return inflight
  }
  inflight = (async () => {
    try {
      do {
        again = false
        const client = await whenReady()
        const [models, providers, agents] = await Promise.all([
          client.model.list(),
          client.provider.list(),
          client.agent.list(),
        ])
        catalogStore.setState({
          models: models.data,
          providers: providers.data,
          agents: agents.data,
          loaded: true,
        })
        await ensureDefaultModel(models.data, () => client.model.default())
      } while (again)
    } finally {
      inflight = undefined
    }
  })()
  return inflight
}

/**
 * A fresh install (or a removed provider) leaves no usable default model in settings, so the composer would say
 * "Select model" even though OpenCode has one. Adopt the server default, else the first enabled chat model.
 */
async function ensureDefaultModel(
  models: readonly ModelInfo[],
  serverDefault: () => Promise<{ data: ModelInfo | null | undefined }>,
) {
  if (!models.length) return
  const current = getSettings().defaultModel
  if (current && models.some((m) => m.providerID === current.providerID && m.id === current.id)) return
  const fallback = await serverDefault()
    .then((r) => r.data ?? undefined)
    .catch(() => undefined)
  const pick = fallback ?? models.find((m) => m.enabled) ?? models[0]
  if (!pick) return
  await updateSettings({ defaultModel: { providerID: pick.providerID, id: pick.id } })
}

let debounce: ReturnType<typeof setTimeout> | undefined

export function handleCatalogEvent(event: OpenCodeEvent) {
  if (!REFRESH_EVENTS.has(event.type)) return
  // A config reload emits a burst of *.updated events; refresh once.
  clearTimeout(debounce)
  debounce = setTimeout(() => void refreshCatalog().catch(() => undefined), 150)
}

export function hasAgent(id: string) {
  return catalogStore.getState().agents.some((a) => a.id === id)
}

export const useModels = () => useStore(catalogStore, (s) => s.models)
export const useProviders = () => useStore(catalogStore, (s) => s.providers)
export const useAgents = () => useStore(catalogStore, (s) => s.agents)
