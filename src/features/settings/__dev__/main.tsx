/**
 * Dev harness for Settings + ModelSelector (visual checks / screenshots).
 *   VITE_OPAL_MOCK=1 pnpm dev  →  http://localhost:1420/src/features/settings/__dev__/index.html?tab=models&theme=dark
 * Query: tab=<settings tab> | view=selector, theme=light|dark, seed=1 (adds sample providers).
 * Not part of the app bundle (only reachable through this HTML entry in dev).
 */
import React, { useEffect, useState } from "react"
import ReactDOM from "react-dom/client"
import "@/index.css"
import { runtime } from "@/lib/runtime"
import { TooltipProvider } from "@/components/ui/tooltip"
import { findPreset } from "@/lib/config/provider-presets"
import { draftFromPreset, draftToProvider } from "@/lib/config/provider-form"
import { SettingsDialog } from "../SettingsDialog"
import { ModelSelector } from "@/features/models/ModelSelector"

const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light"

async function seed() {
  if (params.get("seed") !== "1") return
  const zai = draftToProvider(draftFromPreset(findPreset("zai")!, []))
  const ollama = {
    ...draftToProvider(draftFromPreset(findPreset("ollama")!, [])),
    models: [{ id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" }],
  }
  const deepseek = { ...draftToProvider(draftFromPreset(findPreset("deepseek")!, [])), enabled: false }
  for (const provider of [zai, ollama, deepseek]) await runtime.saveProvider(provider)
}

function Harness() {
  const [open, setOpen] = useState(true)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void seed().then(() => setReady(true))
  }, [])
  if (!ready) return null
  if (params.get("view") === "selector") {
    return (
      <div className="flex h-full items-start justify-center gap-6 bg-bg p-10">
        <ModelSelector value={{ providerID: "zai", id: "glm-4.6" }} />
        <ModelSelector compact value={{ providerID: "zai", id: "glm-4.6" }} />
      </div>
    )
  }
  return (
    <div className="h-full bg-bg">
      <button className="m-4 rounded-md border border-border px-3 py-1 text-sm" onClick={() => setOpen(true)}>
        Open settings
      </button>
      <SettingsDialog open={open} onOpenChange={setOpen} initialTab={params.get("tab") ?? undefined} />
    </div>
  )
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider>
      <Harness />
    </TooltipProvider>
  </React.StrictMode>,
)
