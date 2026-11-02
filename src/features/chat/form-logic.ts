/**
 * Pure helpers behind QuestionCard: the editable draft of an OpenCode form, `when` visibility, and the
 * answer the server accepts. Validation mirrors upstream `validateAnswer` (packages/core/src/form.ts):
 * unknown/inactive keys are rejected, so inactive fields are left out of the answer, and `external` fields
 * must be acknowledged with `true`.
 */
import type { FormField, FormInfo, FormValue } from "@/lib/opencode/types"

/** Per-field editing state. */
export interface FieldDraft {
  /** string with options: the chosen option value. */
  choice?: string
  /** multiselect: chosen option values. */
  selected?: string[]
  /** Free text: string without options, "Type your own answer", or the raw number input. */
  text?: string
  /** The custom ("Type your own answer") entry is chosen (string) / ticked (multiselect). */
  custom?: boolean
  bool?: boolean
  /** external: the link was opened. */
  ack?: boolean
}
export type FormDraft = Record<string, FieldDraft>
export type FormAnswerDraft = Record<string, FormValue>

type When = NonNullable<Exclude<FormField, { type: "external" }>["when"]>[number]

function num(v: number | string | undefined) {
  return v === undefined ? undefined : Number(v)
}

export function isQuestionForm(form: Pick<FormInfo, "metadata">) {
  return form.metadata?.kind === "question"
}

export function initialDraft(fields: readonly FormField[]): FormDraft {
  const draft: FormDraft = {}
  for (const f of fields) {
    if (f.type === "string") {
      if (f.options?.length) {
        if (f.default === undefined) draft[f.key] = {}
        else if (f.options.some((o) => o.value === f.default)) draft[f.key] = { choice: f.default }
        else draft[f.key] = { custom: true, text: f.default }
      } else draft[f.key] = { text: f.default ?? "" }
    } else if (f.type === "number" || f.type === "integer")
      draft[f.key] = { text: f.default === undefined ? "" : String(f.default) }
    else if (f.type === "boolean") draft[f.key] = { bool: f.default }
    else if (f.type === "multiselect") draft[f.key] = { selected: [...(f.default ?? [])], text: "" }
    else draft[f.key] = { ack: false }
  }
  return draft
}

function matches(when: When, value: FormValue | undefined) {
  if (value === undefined) return false
  const hit = Array.isArray(value) ? value.some((v) => v === when.value) : value === when.value
  return when.op === "eq" ? hit : !hit
}

/** A field is active when all its `when` conditions hold against the answers so far. */
export function isFieldActive(field: FormField, answer: FormAnswerDraft) {
  if (field.type === "external" || !field.when) return true
  return field.when.every((w) => matches(w, answer[w.key]))
}

/** The value a field contributes, or undefined when unanswered. Numbers that don't parse yield NaN. */
export function fieldValue(field: FormField, d: FieldDraft = {}): FormValue | undefined {
  switch (field.type) {
    case "string":
      if (field.options?.length) return d.custom ? d.text?.trim() || undefined : d.choice
      return d.text ? d.text : undefined
    case "number":
    case "integer": {
      const t = d.text?.trim()
      return t ? Number(t) : undefined
    }
    case "boolean":
      return d.bool
    case "multiselect": {
      const extra = d.custom && d.text?.trim() ? [d.text.trim()] : []
      const all = [...(d.selected ?? []), ...extra]
      return all.length ? all : undefined
    }
    case "external":
      return d.ack ? true : undefined
  }
}

function fieldError(field: FormField, value: FormValue | undefined): string | undefined {
  if (field.type === "external") return value === true ? undefined : "Open the link to continue"
  if (value === undefined) return field.required ? "Required" : undefined
  if (field.type === "string" && typeof value === "string") {
    if (field.minLength !== undefined && value.length < field.minLength)
      return `At least ${field.minLength} characters`
    if (field.maxLength !== undefined && value.length > field.maxLength)
      return `At most ${field.maxLength} characters`
    if (field.pattern !== undefined) {
      try {
        if (!new RegExp(field.pattern).test(value)) return "Doesn't match the expected format"
      } catch {
        return undefined
      }
    }
    if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Enter an email address"
    if (field.format === "uri" && !URL.canParse(value)) return "Enter a URL"
    if (field.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Enter a date"
    if (field.format === "date-time" && Number.isNaN(new Date(value).getTime()))
      return "Enter a date and time"
    if (field.options?.length && !field.custom && !field.options.some((o) => o.value === value))
      return "Choose one of the options"
  }
  if ((field.type === "number" || field.type === "integer") && typeof value === "number") {
    if (!Number.isFinite(value)) return "Enter a number"
    if (field.type === "integer" && !Number.isInteger(value)) return "Enter a whole number"
    const min = num(field.minimum)
    const max = num(field.maximum)
    if (min !== undefined && value < min) return `Must be at least ${min}`
    if (max !== undefined && value > max) return `Must be at most ${max}`
  }
  if (field.type === "multiselect" && Array.isArray(value)) {
    if (field.minItems !== undefined && value.length < field.minItems)
      return `Choose at least ${field.minItems}`
    if (field.maxItems !== undefined && value.length > field.maxItems)
      return `Choose at most ${field.maxItems}`
  }
  return undefined
}

export interface FormEvaluation {
  /** The answer to send: active, answered fields only (hidden fields send their default). */
  answer: FormAnswerDraft
  /** Fields to render, in order (active and not hidden). */
  visible: FormField[]
  /** Validation messages by field key (visible fields only). */
  errors: Record<string, string>
}

/** Computes the answer, the visible fields and validation errors for a draft. */
export function evaluateForm(fields: readonly FormField[], draft: FormDraft): FormEvaluation {
  const answer: FormAnswerDraft = {}
  const visible: FormField[] = []
  const errors: Record<string, string> = {}
  for (const field of fields) {
    // `when` may only reference earlier fields, so evaluating in order sees every answer it depends on.
    if (!isFieldActive(field, answer)) continue
    if (field.type !== "external" && field.hidden) {
      if (field.default !== undefined) answer[field.key] = field.default
      continue
    }
    visible.push(field)
    const value = fieldValue(field, draft[field.key])
    const error = fieldError(field, value)
    if (error) errors[field.key] = error
    if (value !== undefined) answer[field.key] = value
  }
  return { answer, visible, errors }
}
