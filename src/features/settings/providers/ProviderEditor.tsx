import {
  ArrowLeft,
  CircleCheck,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  LoaderCircle,
  Plug,
  Plus,
  TriangleAlert,
  X,
} from "lucide-react"
import { useMemo, useState } from "react"
import { runtime } from "@/lib/runtime"
import type { ProviderConfig } from "@/lib/runtime/contracts"
import { sanitizeProviderID } from "@/lib/config/ids"
import {
  discoverModels,
  mergeDiscoveredModels,
  presetForProvider,
  type ProviderPreset,
} from "@/lib/config/provider-presets"
import {
  draftToProvider,
  hasErrors,
  requiresBaseURL,
  validateDraft,
  type DraftErrors,
  type ProviderDraft,
} from "@/lib/config/provider-form"
import { DEFAULT_BASE_URL } from "@/lib/config/build"
import { cn } from "@/lib/utils"
import { Button, Field, Select, Switch, TextInput } from "../controls"

/** Provider types that speak OpenAI Chat through third-party endpoints, where finish_reason is often missing. */
const STREAMING_TOGGLE_TYPES = new Set(["openai-compatible", "custom", "ollama", "lmstudio", "openrouter"])
import { ModelsTable } from "./ModelsTable"
import { errorMessage, openExternal, TYPE_LABELS } from "./shared"

type Notice = { tone: "success" | "error" | "info"; text: string } | undefined

export function ProviderEditor({
  initial,
  isNew,
  preset,
  takenIDs,
  onDone,
}: {
  initial: ProviderDraft
  isNew: boolean
  preset?: ProviderPreset
  takenIDs: string[]
  onDone(saved?: ProviderConfig): void
}) {
  const [draft, setDraft] = useState(initial)
  const [showKey, setShowKey] = useState(false)
  const [errors, setErrors] = useState<DraftErrors>({})
  const [busy, setBusy] = useState<"save" | "test" | "fetch" | "delete" | undefined>()
  const [notice, setNotice] = useState<Notice>()
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latencyMs?: number }>()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const effectivePreset = preset ?? presetForProvider(draft)
  const requiresKey = effectivePreset?.requiresKey ?? false
  const set = (patch: Partial<ProviderDraft>) => {
    setDraft((current) => {
      const next = { ...current, ...patch }
      if (patch.name !== undefined && current.idFollowsName && isNew)
        next.id = sanitizeProviderID(patch.name || "custom")
      return next
    })
    setTestResult(undefined)
  }
  const taken = useMemo(
    () => takenIDs.filter((id) => id !== initial.id || isNew),
    [takenIDs, initial.id, isNew],
  )

  const validate = () => {
    const next = validateDraft(draft, { isNew, takenIDs: taken, requiresKey })
    setErrors(next)
    return !hasErrors(next)
  }

  const save = async () => {
    if (!validate()) return
    setBusy("save")
    setNotice(undefined)
    try {
      const provider = draftToProvider(draft)
      await runtime.saveProvider(provider)
      onDone(provider)
    } catch (error) {
      setNotice({ tone: "error", text: `Couldn't save: ${errorMessage(error)}` })
    } finally {
      setBusy(undefined)
    }
  }

  const test = async () => {
    setBusy("test")
    setTestResult(undefined)
    try {
      const provider = draftToProvider(draft)
      const modelID = provider.models.find((model) => model.enabled !== false)?.id
      setTestResult(await runtime.testProvider(provider, modelID))
    } catch (error) {
      setTestResult({ ok: false, message: errorMessage(error) })
    } finally {
      setBusy(undefined)
    }
  }

  const fetchModels = async () => {
    setBusy("fetch")
    setNotice(undefined)
    const result = await discoverModels(draftToProvider(draft))
    setBusy(undefined)
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error })
      return
    }
    const merged = mergeDiscoveredModels(draft.models, result.models)
    set({ models: merged.models })
    setNotice({
      tone: result.models.length ? "success" : "info",
      text: result.models.length
        ? merged.added
          ? `Found ${result.models.length} models — added ${merged.added} new.`
          : `Found ${result.models.length} models — your list is up to date.`
        : "The endpoint returned no models.",
    })
  }

  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy("delete")
    try {
      await runtime.deleteProvider(initial.id)
      onDone()
    } catch (error) {
      setNotice({ tone: "error", text: `Couldn't delete: ${errorMessage(error)}` })
      setBusy(undefined)
    }
  }

  const baseURLPlaceholder =
    DEFAULT_BASE_URL[draft.type] ??
    (requiresBaseURL(draft.type) ? "https://api.example.com/v1" : "Default endpoint")

  return (
    <div className="flex min-h-full flex-col">
      <Button
        variant="ghost"
        size="sm"
        icon={<ArrowLeft className="size-3.5" />}
        onClick={() => onDone()}
        className="-ml-2 mb-3 self-start"
      >
        Models & providers
      </Button>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-fg">
            {isNew ? `Add ${draft.name.trim() || "provider"}` : draft.name || initial.name}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-muted">
            <span>{TYPE_LABELS[draft.type]}</span>
            {effectivePreset?.keyURL && <LinkButton href={effectivePreset.keyURL}>Get an API key</LinkButton>}
            {effectivePreset?.docsURL && <LinkButton href={effectivePreset.docsURL}>Docs</LinkButton>}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-[12.5px] text-fg-secondary">
          Enabled
          <Switch
            aria-label="Provider enabled"
            checked={draft.enabled}
            onCheckedChange={(enabled) => set({ enabled })}
          />
        </label>
      </div>

      {STREAMING_TOGGLE_TYPES.has(draft.type) && (
        <label className="flex items-start justify-between gap-4 rounded-md border border-border px-3.5 py-2.5 text-[13px]">
          <span>
            <span className="block text-fg">Tolerate streams that end without finish_reason</span>
            <span className="block text-[12px] text-fg-muted">
              Many proxies and local servers drop the final chunk; with this on, OpenCode accepts the reply
              instead of retrying the step. Turn it off for strict streaming.
            </span>
          </span>
          <Switch
            aria-label="Tolerate streams without finish_reason"
            checked={!draft.strictStreaming}
            onCheckedChange={(tolerant) => set({ strictStreaming: !tolerant })}
          />
        </label>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        <Field label="Name" error={errors.name} htmlFor="provider-name">
          <TextInput
            id="provider-name"
            value={draft.name}
            invalid={Boolean(errors.name)}
            placeholder="My provider"
            onChange={(event) => set({ name: event.target.value })}
            autoFocus={isNew}
          />
        </Field>
        <Field
          label="Provider ID"
          htmlFor="provider-id"
          error={errors.id}
          hint={
            isNew
              ? "Used in model references like id/model. Can't be changed later."
              : "Fixed after creation."
          }
        >
          <TextInput
            id="provider-id"
            mono
            value={draft.id}
            invalid={Boolean(errors.id)}
            disabled={!isNew}
            onChange={(event) => set({ id: event.target.value.toLowerCase(), idFollowsName: false })}
          />
        </Field>
        <Field label="Type" htmlFor="provider-type">
          <Select<ProviderConfig["type"]>
            ariaLabel="Provider type"
            value={draft.type}
            onValueChange={(type) => set({ type })}
            options={(Object.keys(TYPE_LABELS) as ProviderConfig["type"][]).map((value) => ({
              value,
              label: TYPE_LABELS[value],
            }))}
            className="w-full"
          />
        </Field>
        {draft.type === "custom" ? (
          <Field
            label="Package"
            htmlFor="provider-package"
            error={errors.package}
            hint="An AI SDK provider package, e.g. @ai-sdk/mistral."
          >
            <TextInput
              id="provider-package"
              mono
              value={draft.package}
              invalid={Boolean(errors.package)}
              placeholder="@ai-sdk/…"
              onChange={(event) => set({ package: event.target.value })}
            />
          </Field>
        ) : (
          <div />
        )}
        <Field
          label="Endpoint"
          htmlFor="provider-url"
          className="col-span-2"
          error={errors.baseURL}
          hint={
            requiresBaseURL(draft.type)
              ? "The base URL that serves /chat/completions and /models."
              : "Leave empty to use the provider's default endpoint."
          }
        >
          <TextInput
            id="provider-url"
            mono
            value={draft.baseURL}
            invalid={Boolean(errors.baseURL)}
            placeholder={baseURLPlaceholder}
            onChange={(event) => set({ baseURL: event.target.value })}
          />
        </Field>
        <Field
          label="API key"
          htmlFor="provider-key"
          className="col-span-2"
          error={errors.apiKey}
          hint={
            isNew
              ? "Stored in OpenCode's encrypted credential store — never in Opal's settings file."
              : "Leave empty to keep the stored key. Enter a new key to replace it."
          }
        >
          <div className="relative">
            <TextInput
              id="provider-key"
              mono
              type={showKey ? "text" : "password"}
              value={draft.apiKey}
              invalid={Boolean(errors.apiKey)}
              placeholder={isNew ? (requiresKey ? "sk-…" : "Optional") : "••••••••  (stored)"}
              onChange={(event) => set({ apiKey: event.target.value })}
              className="pr-9"
            />
            <button
              type="button"
              aria-label={showKey ? "Hide API key" : "Show API key"}
              onClick={() => setShowKey((value) => !value)}
              className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-fg-muted hover:bg-bg-muted hover:text-fg"
            >
              {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
        </Field>
      </div>

      <HeadersEditor draft={draft} set={set} error={errors.headers} />

      <div className="mt-6 mb-2 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-fg">Models</h3>
          <p className="text-[12px] text-fg-muted">
            {effectivePreset?.local
              ? "Fetch the models installed on this Mac."
              : "Add the model IDs you want, or fetch them from the endpoint."}
          </p>
        </div>
        <Button
          size="sm"
          icon={
            busy === "fetch" ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )
          }
          onClick={fetchModels}
          disabled={busy !== undefined}
        >
          Fetch models
        </Button>
      </div>
      <ModelsTable
        models={draft.models}
        onChange={(models) => set({ models })}
        rowErrors={errors.modelRows}
      />
      {errors.models && <p className="mt-1.5 text-[12px] text-danger">{errors.models}</p>}

      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-[12.5px]",
            notice.tone === "error" && "bg-danger-soft text-danger",
            notice.tone === "success" && "bg-success/10 text-success",
            notice.tone === "info" && "bg-bg-muted text-fg-secondary",
          )}
        >
          {notice.tone === "error" ? (
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
          ) : (
            <CircleCheck className="mt-px size-3.5 shrink-0" />
          )}
          <span className="selectable">{notice.text}</span>
        </div>
      )}

      <div className="sticky bottom-[-32px] mt-auto -mx-8 -mb-8 flex items-center gap-2 border-t border-border bg-bg px-8 py-3">
        {!isNew && (
          <Button
            variant={confirmDelete ? "danger" : "danger-ghost"}
            onClick={remove}
            disabled={busy !== undefined}
            onBlur={() => setConfirmDelete(false)}
          >
            {confirmDelete ? "Confirm delete" : "Delete"}
          </Button>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button
            icon={
              busy === "test" ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Plug className="size-3.5" />
              )
            }
            onClick={test}
            disabled={busy !== undefined}
          >
            Test connection
          </Button>
          {testResult && (
            <span
              role="status"
              className={cn(
                "selectable min-w-0 truncate text-[12.5px]",
                testResult.ok ? "text-success" : "text-danger",
              )}
              title={testResult.message}
            >
              {testResult.ok
                ? `Connected${testResult.latencyMs !== undefined ? ` · ${Math.round(testResult.latencyMs)} ms` : ""}`
                : testResult.message}
            </span>
          )}
        </div>
        <Button variant="ghost" onClick={() => onDone()} disabled={busy === "save"}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} disabled={busy !== undefined}>
          {busy === "save" && <LoaderCircle className="size-3.5 animate-spin" />}
          {isNew ? "Add provider" : "Save"}
        </Button>
      </div>
    </div>
  )
}

function HeadersEditor({
  draft,
  set,
  error,
}: {
  draft: ProviderDraft
  set(patch: Partial<ProviderDraft>): void
  error?: string
}) {
  const rows = draft.headers
  const update = (index: number, patch: Partial<(typeof rows)[number]>) =>
    set({ headers: rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) })
  return (
    <div className="mt-5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-fg-secondary">Custom headers</span>
        <Button
          variant="ghost"
          size="sm"
          icon={<Plus className="size-3.5" />}
          onClick={() => set({ headers: [...rows, { key: "", value: "" }] })}
        >
          Add header
        </Button>
      </div>
      {rows.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {rows.map((row, index) => (
            <div
              key={index}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_26px] items-center gap-1.5"
            >
              <TextInput
                mono
                aria-label={`Header ${index + 1} name`}
                placeholder="X-Header"
                value={row.key}
                onChange={(event) => update(index, { key: event.target.value })}
                className="h-7"
              />
              <TextInput
                mono
                aria-label={`Header ${index + 1} value`}
                placeholder="value"
                value={row.value}
                onChange={(event) => update(index, { value: event.target.value })}
                className="h-7"
              />
              <button
                type="button"
                aria-label={`Remove header ${index + 1}`}
                onClick={() => set({ headers: rows.filter((_, i) => i !== index) })}
                className="flex size-6 items-center justify-center rounded-md text-fg-faint hover:bg-bg-muted hover:text-fg"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-1 text-[12px] text-danger">{error}</p>}
    </div>
  )
}

function LinkButton({ href, children }: { href: string; children: string }) {
  return (
    <button
      type="button"
      onClick={() => void openExternal(href)}
      className="inline-flex items-center gap-1 text-fg-secondary underline-offset-2 hover:text-fg hover:underline"
    >
      {children}
      <ExternalLink className="size-3" />
    </button>
  )
}
