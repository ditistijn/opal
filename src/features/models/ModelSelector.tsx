/**
 * Model picker. Lists the live model catalog from OpenCode (runtime.useModels — never hardcoded),
 * grouped by provider, with context window and capability glyphs. Keyboard navigable; search appears when the
 * list is long. With `sessionID` it switches that session's model, otherwise it reports through `onChange`.
 */
import * as Popover from "@radix-ui/react-popover"
import { Brain, Check, ChevronDown, Eye, Search, Settings2, Wrench } from "lucide-react"
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { runtime } from "@/lib/runtime"
import type { ModelInfo, ModelRef } from "@/lib/opencode/types"
import { cn } from "@/lib/utils"
import { formatTokens, modelCapabilities, sameModel, selectableModels } from "./format"

const SettingsDialog = lazy(() =>
  import("@/features/settings/SettingsDialog").then((m) => ({ default: m.SettingsDialog })),
)

/** Show the search field once there are more than this many models. */
const SEARCH_THRESHOLD = 8

export interface ModelSelectorProps {
  sessionID?: string
  value?: ModelRef
  onChange?(model: ModelRef): void
  compact?: boolean
  /** Override what "Manage models…" does (defaults to opening Settings → Models & providers). */
  onManageModels?(): void
  className?: string
  align?: "start" | "center" | "end"
}

interface Group {
  providerID: string
  providerName: string
  models: ModelInfo[]
}

export function ModelSelector({
  sessionID,
  value,
  onChange,
  compact,
  onManageModels,
  className,
  align = "start",
}: ModelSelectorProps) {
  const models = runtime.useModels()
  const providers = runtime.useProviders()
  const session = runtime.useSession(sessionID)
  const settings = runtime.useSettings()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listID = useId()

  const current: ModelRef | undefined =
    (sessionID ? session?.model : undefined) ?? value ?? settings.defaultModel

  const providerNames = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.name])),
    [providers],
  )
  const available = useMemo(() => selectableModels(models), [models])
  const showSearch = available.length > SEARCH_THRESHOLD

  const groups = useMemo<Group[]>(() => {
    const q = query.trim().toLowerCase()
    const byProvider = new Map<string, ModelInfo[]>()
    for (const model of available) {
      const providerName = providerNames.get(model.providerID) ?? model.providerID
      if (q && ![model.name, model.id, providerName].some((text) => text.toLowerCase().includes(q))) continue
      const list = byProvider.get(model.providerID) ?? []
      list.push(model)
      byProvider.set(model.providerID, list)
    }
    return [...byProvider.entries()]
      .map(([providerID, list]) => ({
        providerID,
        providerName: providerNames.get(providerID) ?? providerID,
        models: list.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.providerName.localeCompare(b.providerName))
  }, [available, providerNames, query])

  const flat = useMemo(() => groups.flatMap((group) => group.models), [groups])
  const currentInfo = current && available.find((model) => sameModel(current, model))
  const currentName = currentInfo
    ? `${currentInfo.name}${current?.variant ? ` · ${current.variant}` : ""}`
    : current?.id
  const currentProvider = current && (providerNames.get(current.providerID) ?? current.providerID)

  useEffect(() => {
    if (!open) return
    const index = flat.findIndex((model) => sameModel(current, model))
    setActive(index >= 0 ? index : 0)
    // Only when opening or when the filter changes the list.
  }, [open, query])

  useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView?.({ block: "nearest" })
  }, [active, open])

  const choose = (model: ModelInfo, variant?: string) => {
    const ref: ModelRef = { providerID: model.providerID, id: model.id, ...(variant ? { variant } : {}) }
    setOpen(false)
    if (sessionID) void runtime.setSessionModel(sessionID, ref)
    onChange?.(ref)
  }

  const manage = () => {
    setOpen(false)
    if (onManageModels) onManageModels()
    else setSettingsOpen(true)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((index) => (flat.length ? (index + 1) % flat.length : 0))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((index) => (flat.length ? (index - 1 + flat.length) % flat.length : 0))
    } else if (event.key === "Home") {
      event.preventDefault()
      setActive(0)
    } else if (event.key === "End") {
      event.preventDefault()
      setActive(Math.max(0, flat.length - 1))
    } else if (event.key === "Enter") {
      event.preventDefault()
      const model = flat[active]
      if (model) choose(model)
    }
  }

  let index = -1
  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={currentName ? `Model: ${currentName}` : "Select model"}
            aria-haspopup="listbox"
            className={cn(
              "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md text-fg-secondary transition-fast hover:bg-bg-muted hover:text-fg data-[state=open]:bg-bg-muted data-[state=open]:text-fg",
              compact
                ? "h-7 px-2 text-[13px]"
                : "h-8 border border-border-strong bg-bg-elevated px-2.5 text-[13px] text-fg",
              className,
            )}
          >
            <span className="truncate font-medium">{currentName ?? "Select model"}</span>
            {!compact && currentProvider && <span className="truncate text-fg-muted">{currentProvider}</span>}
            <ChevronDown className="size-3.5 shrink-0 text-fg-muted" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align={align}
            sideOffset={6}
            collisionPadding={12}
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              ;(showSearch ? searchRef.current : listRef.current)?.focus()
            }}
            onKeyDown={onKeyDown}
            className="z-[60] flex max-h-[min(460px,var(--radix-popover-content-available-height))] w-[320px] flex-col overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-elevated"
          >
            {showSearch && (
              <div className="flex items-center gap-2 border-b border-border px-3">
                <Search className="size-3.5 shrink-0 text-fg-muted" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search models"
                  aria-label="Search models"
                  aria-controls={listID}
                  aria-activedescendant={flat[active] ? `${listID}-${active}` : undefined}
                  spellCheck={false}
                  className="selectable h-9 w-full bg-transparent text-[13px] text-fg placeholder:text-fg-faint focus:outline-none"
                />
              </div>
            )}
            <div
              ref={listRef}
              id={listID}
              role="listbox"
              aria-label="Models"
              tabIndex={showSearch ? -1 : 0}
              aria-activedescendant={!showSearch && flat[active] ? `${listID}-${active}` : undefined}
              className="min-h-0 flex-1 overflow-y-auto p-1 focus:outline-none"
            >
              {available.length === 0 ? (
                <div className="px-3 py-6 text-center text-[13px] text-fg-muted">
                  No models available yet.
                  <br />
                  Add a provider to get started.
                </div>
              ) : flat.length === 0 ? (
                <div className="px-3 py-6 text-center text-[13px] text-fg-muted">
                  No models match “{query}”.
                </div>
              ) : (
                groups.map((group) => (
                  <div key={group.providerID} role="group" aria-label={group.providerName} className="py-0.5">
                    <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-fg-muted uppercase">
                      {group.providerName}
                    </div>
                    {group.models.map((model) => {
                      index += 1
                      const i = index
                      const selected = sameModel(current, model)
                      const caps = modelCapabilities(model)
                      const context = formatTokens(model.limit.context)
                      return (
                        <div
                          key={`${model.providerID}/${model.id}`}
                          id={`${listID}-${i}`}
                          data-index={i}
                          role="option"
                          aria-selected={selected}
                          onMouseMove={() => setActive(i)}
                          onClick={() => choose(model)}
                          className={cn(
                            "flex cursor-default items-center gap-2 rounded-md px-2.5 py-1.5",
                            i === active && "bg-bg-muted",
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] text-fg">{model.name}</div>
                            <div className="flex items-center gap-1.5 text-[11.5px] text-fg-muted">
                              {context && <span>{context} context</span>}
                              <span className="flex items-center gap-1 text-fg-faint">
                                {caps.tools && <Wrench aria-label="Tools" className="size-3" />}
                                {caps.vision && <Eye aria-label="Vision" className="size-3" />}
                                {caps.reasoning && <Brain aria-label="Reasoning" className="size-3" />}
                              </span>
                            </div>
                            {model.variants.length > 0 && (
                              // Thinking effort: OpenCode model variants (e.g. low / high / max). Lower = faster replies.
                              <div
                                className="mt-1 flex items-center gap-1"
                                role="radiogroup"
                                aria-label={`Thinking effort for ${model.name}`}
                              >
                                <span className="mr-0.5 text-[11px] text-fg-faint">Thinking</span>
                                {model.variants.map((v) => {
                                  const on = selected && (current?.variant ?? "") === v.id
                                  return (
                                    <button
                                      key={v.id}
                                      type="button"
                                      role="radio"
                                      aria-checked={on}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        choose(model, v.id)
                                      }}
                                      className={cn(
                                        "rounded-full border px-1.5 py-px text-[10.5px] capitalize transition-fast",
                                        on
                                          ? "border-accent/40 bg-accent-soft text-fg"
                                          : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                                      )}
                                    >
                                      {v.id}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                          {selected && <Check aria-hidden className="size-4 shrink-0 text-fg-secondary" />}
                        </div>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-border p-1">
              <button
                type="button"
                onClick={manage}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-fg-secondary hover:bg-bg-muted hover:text-fg"
              >
                <Settings2 className="size-3.5" />
                Manage models…
              </button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} initialTab="models" />
        </Suspense>
      )}
    </>
  )
}

export default ModelSelector
