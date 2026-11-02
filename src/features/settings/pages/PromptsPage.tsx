import { Pencil, RotateCcw } from "lucide-react"
import { useEffect, useState } from "react"
import { runtime } from "@/lib/runtime"
import type { ModeID } from "@/lib/runtime/contracts"
import { BUILTIN_PLACEHOLDER, BUILTIN_PROMPTS, MODE_IDS, MODES } from "@/lib/config/prompts"
import { cn } from "@/lib/utils"
import { Badge, Button, PageHeader } from "../controls"
import { errorMessage } from "../providers/shared"

export function PromptsPage() {
  const settings = runtime.useSettings()
  const [mode, setMode] = useState<ModeID>(settings.defaultMode)
  const [editing, setEditing] = useState<string | undefined>()
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)

  const override = settings.promptOverrides[mode]
  // The bundled resources/prompts/*.md are the source of truth for built-in prompts.
  const builtin = BUILTIN_PROMPTS[mode]

  useEffect(() => {
    setEditing(undefined)
    setError(undefined)
  }, [mode])

  const save = async (text: string | undefined) => {
    setSaving(true)
    setError(undefined)
    try {
      await runtime.setPromptOverride(mode, text)
      setEditing(undefined)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const shown = editing ?? override ?? builtin
  const chars = shown.length

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="System prompts"
        description="Each mode runs with its own complete system prompt. Customize one to change how Opal behaves in that mode; the built-in prompt stays available to reset to."
      />
      <div role="tablist" aria-label="Modes" className="mb-4 flex gap-1 border-b border-border">
        {MODE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === mode}
            onClick={() => setMode(id)}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-2.5 pb-2 text-[13px] transition-fast",
              id === mode ? "border-fg text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {MODES[id].label}
            {settings.promptOverrides[id] !== undefined && (
              <span aria-label="customized" className="size-1.5 rounded-full bg-accent" />
            )}
          </button>
        ))}
      </div>

      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {editing !== undefined ? (
            <Badge tone="accent">Editing</Badge>
          ) : override !== undefined ? (
            <Badge tone="accent">Customized</Badge>
          ) : (
            <Badge>Built-in</Badge>
          )}
          <span className="truncate text-[12.5px] text-fg-muted">{MODES[mode].description}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {editing === undefined ? (
            <>
              {override !== undefined && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RotateCcw className="size-3.5" />}
                  onClick={() => void save(undefined)}
                  disabled={saving}
                >
                  Reset to default
                </Button>
              )}
              <Button
                size="sm"
                icon={<Pencil className="size-3.5" />}
                onClick={() => setEditing(override ?? builtin)}
              >
                Customize
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(undefined)} disabled={saving}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw className="size-3.5" />}
                onClick={() => setEditing(builtin)}
                disabled={saving}
              >
                Restore built-in text
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => void save(editing.trim() === "" || editing === builtin ? undefined : editing)}
                disabled={saving}
              >
                Save
              </Button>
            </>
          )}
        </div>
      </div>

      {editing !== undefined ? (
        <textarea
          aria-label={`${MODES[mode].label} system prompt`}
          value={editing}
          onChange={(event) => setEditing(event.target.value)}
          spellCheck={false}
          className="selectable min-h-[300px] w-full flex-1 resize-none rounded-lg border border-border-strong bg-bg-elevated p-3 font-mono text-[12px] leading-relaxed text-fg focus:border-accent focus:ring-2 focus:ring-ring/40 focus:outline-none"
        />
      ) : (
        <pre
          aria-label={`${MODES[mode].label} system prompt preview`}
          tabIndex={0}
          className="selectable min-h-[300px] flex-1 overflow-auto rounded-lg border border-border bg-bg-muted p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-fg-secondary"
        >
          {shown}
        </pre>
      )}
      <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-fg-muted">
        <span>
          Tip: include{" "}
          <code className="rounded bg-bg-inset px-1 font-mono text-[11.5px]">{BUILTIN_PLACEHOLDER}</code> to
          extend the built-in prompt instead of replacing it.
        </span>
        <span className="shrink-0 tabular-nums">
          {chars.toLocaleString()} chars · ~{Math.ceil(chars / 4).toLocaleString()} tokens
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[12.5px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
