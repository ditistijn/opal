import { ChevronRight, CircleCheck, Import, LoaderCircle, Plus, TriangleAlert } from "lucide-react"
import { useMemo, useState } from "react"
import { runtime } from "@/lib/runtime"
import type { ProviderConfig } from "@/lib/runtime/contracts"
import { draftFromPreset, draftFromProvider, type ProviderDraft } from "@/lib/config/provider-form"
import type { ProviderPreset } from "@/lib/config/provider-presets"
import { cn } from "@/lib/utils"
import { Button, PageHeader, Switch } from "../controls"
import { PresetPicker } from "../providers/PresetPicker"
import { ProviderEditor } from "../providers/ProviderEditor"
import { errorMessage, hostLabel, TYPE_LABELS } from "../providers/shared"

type View =
  | { kind: "list" }
  | { kind: "presets" }
  | { kind: "edit"; draft: ProviderDraft; isNew: boolean; preset?: ProviderPreset }

type Notice = { tone: "success" | "error"; text: string } | undefined

export type ProviderStatus = "active" | "pending" | "off"

export function providerStatus(provider: ProviderConfig, liveIDs: Set<string>): ProviderStatus {
  if (!provider.enabled) return "off"
  return liveIDs.has(provider.id) ? "active" : "pending"
}

const STATUS_LABEL: Record<ProviderStatus, string> = {
  active: "Active — models are available",
  pending: "Not loaded by OpenCode yet",
  off: "Disabled",
}

export function ProvidersPage() {
  const settings = runtime.useSettings()
  const live = runtime.useProviders()
  const [view, setView] = useState<View>({ kind: "list" })
  const [notice, setNotice] = useState<Notice>()
  const [importing, setImporting] = useState(false)

  const liveIDs = useMemo(() => new Set(live.map((provider) => provider.id)), [live])
  const takenIDs = settings.providers.map((provider) => provider.id)

  if (view.kind === "presets") {
    return (
      <PresetPicker
        onBack={() => setView({ kind: "list" })}
        onPick={(preset) =>
          setView({ kind: "edit", draft: draftFromPreset(preset, takenIDs), isNew: true, preset })
        }
      />
    )
  }
  if (view.kind === "edit") {
    return (
      <ProviderEditor
        key={view.draft.id}
        initial={view.draft}
        isNew={view.isNew}
        preset={view.preset}
        takenIDs={takenIDs}
        onDone={(saved) => {
          setView({ kind: "list" })
          setNotice(saved ? { tone: "success", text: `${saved.name} saved.` } : undefined)
        }}
      />
    )
  }

  const runImport = async () => {
    setImporting(true)
    setNotice(undefined)
    try {
      const { imported } = await runtime.importOpenCodeConfig()
      setNotice(
        imported
          ? {
              tone: "success",
              text: `Imported ${imported} provider${imported === 1 ? "" : "s"} from your OpenCode CLI config.`,
            }
          : { tone: "success", text: "No new providers found in ~/.config/opencode/opencode.json." },
      )
    } catch (error) {
      setNotice({ tone: "error", text: `Import failed: ${errorMessage(error)}` })
    } finally {
      setImporting(false)
    }
  }

  const toggle = (provider: ProviderConfig, enabled: boolean) =>
    runtime
      .saveProvider({ ...provider, enabled })
      .catch((error) => setNotice({ tone: "error", text: errorMessage(error) }))

  return (
    <div>
      <PageHeader
        title="Models & providers"
        description="Connect any model provider — hosted APIs, OpenAI-compatible endpoints, or models running on this Mac. API keys live in OpenCode's credential store, never in Opal's settings file."
      />
      <div className="mb-3 flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          icon={
            importing ? <LoaderCircle className="size-3.5 animate-spin" /> : <Import className="size-3.5" />
          }
          onClick={runImport}
          disabled={importing}
        >
          Import from OpenCode CLI
        </Button>
        <Button
          variant="primary"
          icon={<Plus className="size-3.5" />}
          onClick={() => setView({ kind: "presets" })}
        >
          Add provider
        </Button>
      </div>

      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-[12.5px]",
            notice.tone === "error" ? "bg-danger-soft text-danger" : "bg-success/10 text-success",
          )}
        >
          {notice.tone === "error" ? (
            <TriangleAlert className="size-3.5 shrink-0" />
          ) : (
            <CircleCheck className="size-3.5 shrink-0" />
          )}
          {notice.text}
        </div>
      )}

      {settings.providers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong px-6 py-10 text-center">
          <p className="text-[14px] text-fg">No providers yet</p>
          <p className="mx-auto mt-1 max-w-[380px] text-[12.5px] text-fg-muted">
            Add Z.AI, Qwen, DeepSeek, OpenRouter, any OpenAI-compatible endpoint, or a local Ollama / LM
            Studio server.
          </p>
          <Button
            variant="secondary"
            className="mt-4"
            icon={<Plus className="size-3.5" />}
            onClick={() => setView({ kind: "presets" })}
          >
            Add provider
          </Button>
        </div>
      ) : (
        <ul aria-label="Providers" className="overflow-hidden rounded-lg border border-border">
          {settings.providers.map((provider) => {
            const status = providerStatus(provider, liveIDs)
            const count = provider.models.length
            return (
              <li
                key={provider.id}
                className="group flex items-center gap-3 border-b border-border bg-bg-elevated px-3.5 py-3 last:border-b-0"
              >
                <span
                  role="img"
                  aria-label={STATUS_LABEL[status]}
                  title={STATUS_LABEL[status]}
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    status === "active" && "bg-success",
                    status === "pending" && "bg-warning",
                    status === "off" && "bg-fg-faint",
                  )}
                />
                <button
                  type="button"
                  onClick={() => setView({ kind: "edit", draft: draftFromProvider(provider), isNew: false })}
                  className="flex min-w-0 flex-1 flex-col text-left"
                >
                  <span className="flex items-center gap-2 truncate text-[13.5px] font-medium text-fg">
                    {provider.name}
                    <span className="font-mono text-[11px] font-normal text-fg-faint">{provider.id}</span>
                  </span>
                  <span className="truncate text-[12px] text-fg-muted">
                    {[
                      TYPE_LABELS[provider.type],
                      hostLabel(provider.baseURL),
                      `${count} model${count === 1 ? "" : "s"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
                <Switch
                  aria-label={`${provider.enabled ? "Disable" : "Enable"} ${provider.name}`}
                  checked={provider.enabled}
                  onCheckedChange={(enabled) => void toggle(provider, enabled)}
                />
                <button
                  type="button"
                  aria-label={`Edit ${provider.name}`}
                  onClick={() => setView({ kind: "edit", draft: draftFromProvider(provider), isNew: false })}
                  className="flex size-7 items-center justify-center rounded-md text-fg-muted transition-fast hover:bg-bg-muted hover:text-fg"
                >
                  <ChevronRight className="size-4" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
