import { Check, ExternalLink, MessageCircleQuestion } from "lucide-react"
import { useId, useMemo, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { useHotkeys } from "@/hooks/use-hotkeys"
import type { FormField } from "@/lib/opencode/types"
import { runtime, type FormRequest } from "@/lib/runtime"
import { cn, isMac, isTauri } from "@/lib/utils"
import { evaluateForm, initialDraft, isQuestionForm, type FieldDraft, type FormDraft } from "./form-logic"

/** Returned to the model when the user skips (it continues instead of the turn ending). */
export const SKIP_MESSAGE = "The user skipped this question without answering."

async function openExternal(href: string) {
  if (!/^https?:\/\//i.test(href)) return
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener")
    await openUrl(href)
  } else window.open(href, "_blank", "noopener,noreferrer")
}

function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message || "Couldn't send the answer"
}

/** One choice row: a radio dot or checkbox, label and description. */
function OptionRow({
  role,
  checked,
  onSelect,
  children,
}: {
  role: "radio" | "checkbox"
  checked: boolean
  onSelect(): void
  children: ReactNode
}) {
  return (
    <div
      role={role}
      aria-checked={checked}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        "flex cursor-default items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        checked ? "border-accent/50 bg-accent-soft" : "border-border hover:bg-bg-muted",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-[3px] flex size-3.5 shrink-0 items-center justify-center border transition-colors duration-[120ms]",
          role === "radio" ? "rounded-full" : "rounded-[4px]",
          checked ? "border-accent bg-accent text-bg" : "border-border-strong bg-bg-elevated",
        )}
      >
        {checked ? (
          role === "radio" ? (
            <span className="size-1.5 rounded-full bg-bg" />
          ) : (
            <Check className="size-2.5" strokeWidth={3} />
          )
        ) : null}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}

const inputClass =
  "selectable h-8 w-full rounded-md border border-border-strong bg-bg-elevated px-2.5 text-[13px] text-fg placeholder:text-fg-muted transition-fast focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-ring/40"

function CustomInput({
  value,
  onChange,
  onFocus,
  label,
}: {
  value: string
  onChange(v: string): void
  onFocus(): void
  label: string
}) {
  return (
    <input
      aria-label={label}
      value={value}
      placeholder="Type your own answer"
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
      onClick={(e) => e.stopPropagation()}
      className="selectable h-5 w-full bg-transparent text-[13.5px] text-fg placeholder:text-fg-muted focus:outline-none"
    />
  )
}

function FieldInput({
  field,
  draft,
  update,
  label,
}: {
  field: FormField
  draft: FieldDraft
  update(patch: Partial<FieldDraft>): void
  label: string
}) {
  if (field.type === "external") {
    let host = field.url
    try {
      host = new URL(field.url).host
    } catch {}
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void openExternal(field.url)
            update({ ack: true })
          }}
        >
          <ExternalLink />
          Open {host}
        </Button>
        {draft.ack ? (
          <span className="flex items-center gap-1 text-[12.5px] text-fg-secondary">
            <Check className="size-3.5 text-success" /> Opened
          </span>
        ) : null}
      </div>
    )
  }
  if (field.type === "boolean")
    return (
      <div role="radiogroup" aria-label={label} className="flex gap-1.5">
        {[true, false].map((v) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={draft.bool === v}
            onClick={() => update({ bool: v })}
            className={cn(
              "h-7 rounded-full border px-3 text-[13px] transition-colors duration-[120ms]",
              draft.bool === v
                ? "border-accent/50 bg-accent-soft text-fg"
                : "border-border text-fg-secondary hover:bg-bg-muted hover:text-fg",
            )}
          >
            {v ? "Yes" : "No"}
          </button>
        ))}
      </div>
    )
  if (field.type === "number" || field.type === "integer")
    return (
      <input
        aria-label={label}
        type="number"
        inputMode={field.type === "integer" ? "numeric" : "decimal"}
        step={field.type === "integer" ? 1 : "any"}
        min={field.minimum === undefined ? undefined : Number(field.minimum)}
        max={field.maximum === undefined ? undefined : Number(field.maximum)}
        value={draft.text ?? ""}
        onChange={(e) => update({ text: e.target.value })}
        className={cn(inputClass, "w-40")}
      />
    )
  if (field.type === "multiselect") {
    const selected = draft.selected ?? []
    return (
      <div role="group" aria-label={label} className="flex flex-col gap-1.5">
        {field.options.map((o) => {
          const on = selected.includes(o.value)
          return (
            <OptionRow
              key={o.value}
              role="checkbox"
              checked={on}
              onSelect={() =>
                update({ selected: on ? selected.filter((v) => v !== o.value) : [...selected, o.value] })
              }
            >
              <OptionText label={o.label} description={o.description} />
            </OptionRow>
          )
        })}
        {field.custom ? (
          <OptionRow
            role="checkbox"
            checked={!!draft.custom}
            onSelect={() => update({ custom: !draft.custom })}
          >
            <CustomInput
              label={`${label}: your own answer`}
              value={draft.text ?? ""}
              onFocus={() => update({ custom: true })}
              onChange={(text) => update({ text, custom: text.trim() ? true : draft.custom })}
            />
          </OptionRow>
        ) : null}
      </div>
    )
  }
  // string
  if (field.options?.length)
    return (
      <div role="radiogroup" aria-label={label} className="flex flex-col gap-1.5">
        {field.options.map((o) => (
          <OptionRow
            key={o.value}
            role="radio"
            checked={!draft.custom && draft.choice === o.value}
            onSelect={() => update({ choice: o.value, custom: false })}
          >
            <OptionText label={o.label} description={o.description} />
          </OptionRow>
        ))}
        {field.custom ? (
          <OptionRow role="radio" checked={!!draft.custom} onSelect={() => update({ custom: true })}>
            <CustomInput
              label={`${label}: your own answer`}
              value={draft.text ?? ""}
              onFocus={() => update({ custom: true })}
              onChange={(text) => update({ text, custom: true })}
            />
          </OptionRow>
        ) : null}
      </div>
    )
  const type =
    field.format === "email"
      ? "email"
      : field.format === "uri"
        ? "url"
        : field.format === "date"
          ? "date"
          : field.format === "date-time"
            ? "datetime-local"
            : "text"
  return (
    <input
      aria-label={label}
      type={type}
      value={draft.text ?? ""}
      placeholder={field.placeholder}
      maxLength={field.maxLength}
      onChange={(e) => update({ text: e.target.value })}
      className={inputClass}
    />
  )
}

function OptionText({ label, description }: { label: string; description?: string }) {
  return (
    <>
      <span className="block text-[13.5px] leading-5 text-fg">{label}</span>
      {description ? (
        <span className="block text-[12.5px] leading-[18px] text-fg-secondary">{description}</span>
      ) : null}
    </>
  )
}

/**
 * Inline card above the composer for an OpenCode form — the `question` tool's questions or any other
 * pending form (string/options/"Type your own answer", multiselect, number, boolean, external link fields,
 * `when` conditions, required validation). Submit replies; Skip cancels with a note to the model.
 * With `shortcuts`, ⌘⏎ submits.
 */
export function QuestionCard({ form, shortcuts = false }: { form: FormRequest; shortcuts?: boolean }) {
  const id = useId()
  const [draft, setDraft] = useState<FormDraft>(() => initialDraft(form.fields))
  const [attempted, setAttempted] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [page, setPage] = useState(0)
  const { answer, visible, errors } = useMemo(() => evaluateForm(form.fields, draft), [form.fields, draft])
  const question = isQuestionForm(form)
  const empty = Object.keys(answer).length === 0
  const invalid = Object.keys(errors).length > 0
  // Several questions are paged one at a time (header chips act as tabs); other forms are stacked.
  const paged = question && visible.length > 1
  const current = Math.min(page, visible.length - 1)
  const shown = paged ? visible.slice(current, current + 1) : visible
  const lastPage = !paged || current === visible.length - 1

  const update = (key: string) => (patch: Partial<FieldDraft>) =>
    setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }))

  const run = async (fn: () => Promise<void>) => {
    if (pending) return
    setPending(true)
    setError(undefined)
    try {
      await fn()
    } catch (e) {
      setError(errorText(e))
      setPending(false)
    }
  }
  const submit = () => {
    setAttempted(true)
    if (invalid || empty) {
      const first = visible.findIndex((f) => errors[f.key])
      if (paged && first >= 0) setPage(first)
      return
    }
    void run(() => runtime.replyForm(form.sessionID, form.id, answer))
  }
  const skip = () => void run(() => runtime.cancelForm(form.sessionID, form.id, SKIP_MESSAGE))
  useHotkeys([{ combo: "mod+enter", enabled: shortcuts, allowInInput: true, handler: submit }])

  const heading = question
    ? form.fields.length > 1
      ? `Opal has ${form.fields.length} questions`
      : "Opal has a question"
    : form.title

  return (
    <div
      role="dialog"
      aria-label={question ? "Question" : form.title}
      aria-describedby={`${id}-heading`}
      className="opal-fade-in mb-3 rounded-xl border border-border bg-bg-elevated p-4 shadow-elevated"
    >
      <div className="flex gap-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <MessageCircleQuestion className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div id={`${id}-heading`} className="text-[12.5px] text-fg-secondary">
            {heading}
          </div>
          {paged ? (
            <div role="tablist" aria-label="Questions" className="mt-2 flex flex-wrap gap-1">
              {visible.map((f, i) => (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={i === current}
                  onClick={() => setPage(i)}
                  className={cn(
                    "flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium transition-colors duration-[120ms]",
                    i === current
                      ? "bg-bg-muted text-fg"
                      : "text-fg-muted hover:bg-bg-muted hover:text-fg-secondary",
                    attempted && errors[f.key] && "text-danger",
                  )}
                >
                  {answer[f.key] !== undefined ? <Check className="size-3 text-success" /> : null}
                  {f.title ?? `Question ${i + 1}`}
                </button>
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex max-h-[45vh] flex-col gap-4 overflow-y-auto">
            {shown.map((field) => {
              const label = field.title ?? field.description ?? field.key
              const required = field.type !== "external" && field.required
              return (
                <div key={field.key} data-field={field.key}>
                  {question ? (
                    <>
                      {field.title && !paged ? (
                        <span className="mb-1 inline-block rounded-md bg-bg-muted px-1.5 py-px text-[11.5px] font-medium text-fg-secondary">
                          {field.title}
                        </span>
                      ) : null}
                      {field.description ? (
                        <p className="selectable mb-2 text-[14px] font-medium text-fg">{field.description}</p>
                      ) : null}
                    </>
                  ) : (
                    <div className="mb-1.5">
                      <div className="text-[13.5px] font-medium text-fg">
                        {label}
                        {required ? <span className="ml-0.5 text-fg-muted">*</span> : null}
                      </div>
                      {field.title && field.description ? (
                        <p className="selectable text-[12.5px] text-fg-secondary">{field.description}</p>
                      ) : null}
                    </div>
                  )}
                  <FieldInput
                    field={field}
                    draft={draft[field.key] ?? {}}
                    update={update(field.key)}
                    label={label}
                  />
                  {attempted && errors[field.key] ? (
                    <p className="mt-1 text-[12px] text-danger">{errors[field.key]}</p>
                  ) : null}
                </div>
              )
            })}
          </div>
          {error ? (
            <p role="alert" className="mt-3 text-[12.5px] text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-3.5 flex items-center justify-end gap-2">
        {attempted && empty && !invalid ? (
          <span className="mr-auto text-[12px] text-fg-muted">Choose an answer or skip</span>
        ) : null}
        <Button variant="outline" size="sm" disabled={pending} onClick={skip}>
          Skip
        </Button>
        {paged && current > 0 ? (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => setPage(current - 1)}>
            Back
          </Button>
        ) : null}
        {lastPage ? (
          <Button
            variant="primary"
            size="sm"
            disabled={pending || (attempted && (invalid || empty))}
            onClick={submit}
          >
            Submit
            {shortcuts ? <Kbd className="-mr-1 text-bg/60">{isMac ? "⌘⏎" : "Ctrl⏎"}</Kbd> : null}
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={() => setPage(current + 1)}>
            Next
          </Button>
        )}
      </div>
    </div>
  )
}
