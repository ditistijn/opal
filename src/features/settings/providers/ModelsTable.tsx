import { Brain, Eye, Plus, Trash2, Wrench } from "lucide-react"
import { useEffect, useState, type ComponentType } from "react"
import type { ModelConfig } from "@/lib/runtime/contracts"
import { emptyModel } from "@/lib/config/provider-form"
import { cn } from "@/lib/utils"
import { formatTokenInput, parseTokenInput } from "@/features/models/format"
import { Button, Switch, TextInput } from "../controls"

type CapabilityKey = "tools" | "vision" | "reasoning"
const CAPABILITIES: { key: CapabilityKey; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { key: "tools", label: "Tool use", icon: Wrench },
  { key: "vision", label: "Vision (image input)", icon: Eye },
  { key: "reasoning", label: "Reasoning", icon: Brain },
]

const GRID = "grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_68px_68px_78px_30px_26px] items-center gap-1.5"

export function ModelsTable({
  models,
  onChange,
  rowErrors,
}: {
  models: ModelConfig[]
  onChange(models: ModelConfig[]): void
  rowErrors?: Record<number, string>
}) {
  const update = (index: number, patch: Partial<ModelConfig>) =>
    onChange(models.map((model, i) => (i === index ? { ...model, ...patch } : model)))
  const remove = (index: number) => onChange(models.filter((_, i) => i !== index))

  return (
    <div className="rounded-lg border border-border">
      <div
        className={cn(GRID, "border-b border-border px-2.5 py-1.5 text-[11.5px] font-medium text-fg-muted")}
      >
        <span>Model ID</span>
        <span>Display name</span>
        <span title="Context window (tokens). Accepts 128K, 1M…">Context</span>
        <span title="Maximum output tokens">Max out</span>
        <span>Capabilities</span>
        <span title="Show in the model picker">On</span>
        <span />
      </div>
      {models.length === 0 ? (
        <div className="px-3 py-5 text-center text-[12.5px] text-fg-muted">
          No models yet. Add one, or fetch the list from the endpoint.
        </div>
      ) : (
        <ul className="max-h-[260px] overflow-y-auto">
          {models.map((model, index) => {
            const error = rowErrors?.[index]
            return (
              <li key={index} className="border-b border-border px-2.5 py-1.5 last:border-b-0">
                <div className={GRID}>
                  <TextInput
                    mono
                    aria-label={`Model ${index + 1} ID`}
                    value={model.id}
                    invalid={Boolean(error)}
                    placeholder="model-id"
                    onChange={(event) => update(index, { id: event.target.value })}
                    className="h-7"
                  />
                  <TextInput
                    aria-label={`Model ${index + 1} display name`}
                    value={model.name}
                    placeholder={model.id || "Name"}
                    onChange={(event) => update(index, { name: event.target.value })}
                    className="h-7"
                  />
                  <TokenInput
                    label={`Model ${index + 1} context window`}
                    value={model.contextWindow}
                    onChange={(contextWindow) => update(index, { contextWindow })}
                  />
                  <TokenInput
                    label={`Model ${index + 1} max output tokens`}
                    value={model.maxOutputTokens}
                    onChange={(maxOutputTokens) => update(index, { maxOutputTokens })}
                  />
                  <div className="flex items-center gap-0.5">
                    {CAPABILITIES.map(({ key, label, icon: Icon }) => {
                      const on = Boolean(model.capabilities?.[key])
                      return (
                        <button
                          key={key}
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          aria-label={`${label} for model ${index + 1}`}
                          title={label}
                          onClick={() =>
                            update(index, { capabilities: { ...model.capabilities, [key]: !on } })
                          }
                          className={cn(
                            "flex size-6 items-center justify-center rounded-md transition-fast",
                            on
                              ? "bg-accent-soft text-accent"
                              : "text-fg-faint hover:bg-bg-muted hover:text-fg-muted",
                          )}
                        >
                          <Icon className="size-3.5" />
                        </button>
                      )
                    })}
                  </div>
                  <Switch
                    aria-label={`Show model ${index + 1} in the picker`}
                    checked={model.enabled !== false}
                    onCheckedChange={(enabled) => update(index, { enabled })}
                  />
                  <button
                    type="button"
                    aria-label={`Remove model ${index + 1}`}
                    onClick={() => remove(index)}
                    className="flex size-6 items-center justify-center rounded-md text-fg-faint transition-fast hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                {error && <p className="mt-1 text-[11.5px] text-danger">{error}</p>}
              </li>
            )
          })}
        </ul>
      )}
      <div className="border-t border-border px-1.5 py-1">
        <Button
          variant="ghost"
          size="sm"
          icon={<Plus className="size-3.5" />}
          onClick={() => onChange([...models, emptyModel()])}
        >
          Add model
        </Button>
      </div>
    </div>
  )
}

/** Token count input that accepts "128K"/"1M" and keeps the user's text while focused. */
function TokenInput({
  value,
  onChange,
  label,
}: {
  value: number | undefined
  onChange(value: number | undefined): void
  label: string
}) {
  const [text, setText] = useState(() => formatTokenInput(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(formatTokenInput(value))
  }, [value, focused])
  const parsed = parseTokenInput(text)
  const invalid = parsed !== undefined && !(Number.isInteger(parsed) && parsed > 0)
  return (
    <TextInput
      aria-label={label}
      value={text}
      invalid={invalid}
      placeholder="—"
      inputMode="numeric"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(event) => {
        setText(event.target.value)
        const next = parseTokenInput(event.target.value)
        onChange(next === undefined || Number.isNaN(next) ? (next === undefined ? undefined : value) : next)
      }}
      className="h-7 text-right tabular-nums"
    />
  )
}
