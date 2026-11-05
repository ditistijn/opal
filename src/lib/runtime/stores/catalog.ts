/** Models / providers / agents catalog, refreshed when the server reports catalog changes. */
import { useStore } from "zustand"
import { createStore } from "zustand/vanilla"
import { whenReady } from "@/lib/opencode/client"
import type { AgentInfo, ModelInfo, OpenCodeEvent, ProviderInfo } from "@/lib/opencode/types"
import { pickVisionModel } from "@/lib/config/vision"
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
        await ensureImageFallbackModel(models.data)
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

/**
 * The image fallback (src/lib/config/vision.ts) needs an image-capable model. When none is set, or the set one is
 * gone or lost image input, adopt one from the catalog and regenerate opencode.json so the vision agent exists.
 */
async function ensureImageFallbackModel(models: readonly ModelInfo[]) {
  const settings = getSettings()
  if (!settings.imageFallback.enabled || !models.length) return
  const current = settings.imageFallback.model
  const pick = pickVisionModel(models, current, settings.defaultModel)
  if (!pick || (current && current.providerID === pick.providerID && current.id === pick.id)) return
  await updateSettings({ imageFallback: { ...settings.imageFallback, model: pick } })
  // Lazy: providers.ts imports this module. applyConfig refreshes the catalog again, which is then a no-op here.
  void import("../providers").then((m) => m.applyConfig()).catch(() => undefined)
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
