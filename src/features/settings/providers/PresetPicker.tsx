import { ArrowLeft, HardDrive } from "lucide-react"
import { PROVIDER_PRESETS, type ProviderPreset } from "@/lib/config/provider-presets"
import { Button, PageHeader } from "../controls"
import { hostLabel } from "./shared"

export function PresetPicker({ onPick, onBack }: { onPick(preset: ProviderPreset): void; onBack(): void }) {
  const cloud = PROVIDER_PRESETS.filter((preset) => !preset.local && preset.id !== "custom")
  const local = PROVIDER_PRESETS.filter((preset) => preset.local)
  const custom = PROVIDER_PRESETS.filter((preset) => preset.id === "custom")
  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        icon={<ArrowLeft className="size-3.5" />}
        onClick={onBack}
        className="-ml-2 mb-3"
      >
        Models & providers
      </Button>
      <PageHeader
        title="Add a provider"
        description="Pick a starting point. Every field stays editable on the next step."
      />
      <PresetGrid presets={cloud} onPick={onPick} />
      <h3 className="mt-6 mb-2 text-[12px] font-medium tracking-wide text-fg-muted uppercase">On this Mac</h3>
      <PresetGrid presets={local} onPick={onPick} />
      <h3 className="mt-6 mb-2 text-[12px] font-medium tracking-wide text-fg-muted uppercase">
        Anything else
      </h3>
      <PresetGrid presets={custom} onPick={onPick} />
    </div>
  )
}

function PresetGrid({
  presets,
  onPick,
}: {
  presets: ProviderPreset[]
  onPick(preset: ProviderPreset): void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          onClick={() => onPick(preset)}
          className="flex flex-col gap-0.5 rounded-lg border border-border bg-bg-elevated px-3.5 py-3 text-left transition-fast hover:border-border-strong hover:bg-bg-muted"
        >
          <span className="flex items-center gap-1.5 text-[13.5px] font-medium text-fg">
            {preset.local && <HardDrive className="size-3.5 text-fg-muted" />}
            {preset.name}
          </span>
          <span className="line-clamp-2 text-[12.5px] leading-snug text-fg-muted">{preset.description}</span>
          {preset.baseURL && (
            <span className="mt-1 font-mono text-[11px] text-fg-faint">{hostLabel(preset.baseURL)}</span>
          )}
        </button>
      ))}
    </div>
  )
}
