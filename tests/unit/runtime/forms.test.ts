import { describe, expect, it } from "vitest"
import { evaluateForm, initialDraft, isFieldActive } from "@/features/chat/form-logic"
import type { FormField, FormInfo, OpenCodeEvent } from "@/lib/opencode/types"
import { reduceForms } from "@/lib/runtime/stores/forms"

const form = (id: string, sessionID = "ses_a"): FormInfo => ({
  id,
  sessionID,
  title: "Questions",
  metadata: { kind: "question" },
  fields: [{ key: "q0", type: "string", options: [{ value: "A", label: "A" }], custom: true }],
})

const event = (type: string, data: unknown) =>
  ({ id: "evt_1", created: 0, type, data }) as unknown as OpenCodeEvent

describe("reduceForms", () => {
  it("adds created forms per session and ignores duplicates", () => {
    let state = reduceForms({}, event("form.created", { form: form("frm_1") }))
    state = reduceForms(state, event("form.created", { form: form("frm_2") }))
    const same = reduceForms(state, event("form.created", { form: form("frm_1") }))
    expect(same).toBe(state)
    expect(state.ses_a.map((f) => f.id)).toEqual(["frm_1", "frm_2"])
  })

  it("removes replied and cancelled forms, leaving other sessions alone", () => {
    let state = reduceForms({}, event("form.created", { form: form("frm_1") }))
    state = reduceForms(state, event("form.created", { form: form("frm_2") }))
    state = reduceForms(state, event("form.created", { form: form("frm_3", "ses_b") }))
    state = reduceForms(
      state,
      event("form.replied", { id: "frm_1", sessionID: "ses_a", answer: { q0: "A" } }),
    )
    state = reduceForms(state, event("form.cancelled", { id: "frm_3", sessionID: "ses_b" }))
    expect(state.ses_a.map((f) => f.id)).toEqual(["frm_2"])
    expect(state.ses_b).toEqual([])
  })

  it("returns the same state for unrelated events and unknown forms", () => {
    const state = reduceForms({}, event("form.created", { form: form("frm_1") }))
    expect(reduceForms(state, event("session.idle", { sessionID: "ses_a" }))).toBe(state)
    expect(reduceForms(state, event("form.replied", { id: "frm_x", sessionID: "ses_a", answer: {} }))).toBe(
      state,
    )
  })
})

const FIELDS: FormField[] = [
  {
    key: "format",
    type: "string",
    title: "Format",
    required: true,
    options: [
      { value: "md", label: "Markdown" },
      { value: "pdf", label: "PDF" },
    ],
    custom: true,
  },
  {
    key: "pages",
    type: "integer",
    minimum: 1,
    maximum: 10,
    when: [{ key: "format", op: "eq", value: "pdf" }],
  },
  { key: "toc", type: "boolean", default: true },
  {
    key: "sections",
    type: "multiselect",
    options: [
      { value: "intro", label: "Intro" },
      { value: "faq", label: "FAQ" },
    ],
    custom: true,
    maxItems: 2,
  },
  { key: "secret", type: "string", hidden: true, default: "x" },
]

describe("form logic", () => {
  it("starts from defaults and requires required fields", () => {
    const draft = initialDraft(FIELDS)
    const { answer, errors, visible } = evaluateForm(FIELDS, draft)
    expect(answer).toEqual({ toc: true, secret: "x" })
    expect(errors).toEqual({ format: "Required" })
    // `pages` is inactive until format = pdf; hidden fields are never rendered.
    expect(visible.map((f) => f.key)).toEqual(["format", "toc", "sections"])
  })

  it("activates `when` fields and validates integers against their bounds", () => {
    const draft = initialDraft(FIELDS)
    draft.format = { choice: "pdf" }
    draft.pages = { text: "12" }
    let result = evaluateForm(FIELDS, draft)
    expect(result.visible.map((f) => f.key)).toContain("pages")
    expect(result.errors.pages).toBe("Must be at most 10")
    draft.pages = { text: "2.5" }
    expect(evaluateForm(FIELDS, draft).errors.pages).toBe("Enter a whole number")
    draft.pages = { text: "3" }
    result = evaluateForm(FIELDS, draft)
    expect(result.errors).toEqual({})
    expect(result.answer).toMatchObject({ format: "pdf", pages: 3 })
  })

  it("drops answers of fields that become inactive", () => {
    const draft = initialDraft(FIELDS)
    draft.format = { choice: "md" }
    draft.pages = { text: "3" }
    expect(evaluateForm(FIELDS, draft).answer).not.toHaveProperty("pages")
  })

  it("uses the custom answer and appends custom multiselect text", () => {
    const draft = initialDraft(FIELDS)
    draft.format = { choice: "md", custom: true, text: "  AsciiDoc " }
    draft.sections = { selected: ["intro"], custom: true, text: "Glossary" }
    const { answer, errors } = evaluateForm(FIELDS, draft)
    expect(answer.format).toBe("AsciiDoc")
    expect(answer.sections).toEqual(["intro", "Glossary"])
    expect(errors).toEqual({})
    draft.sections = { selected: ["intro", "faq"], custom: true, text: "Glossary" }
    expect(evaluateForm(FIELDS, draft).errors.sections).toBe("Choose at most 2")
  })

  it("matches multiselect conditions by inclusion and treats unanswered as false", () => {
    const field: FormField = { key: "x", type: "string", when: [{ key: "s", op: "neq", value: "faq" }] }
    expect(isFieldActive(field, {})).toBe(false)
    expect(isFieldActive(field, { s: ["intro"] })).toBe(true)
    expect(isFieldActive(field, { s: ["intro", "faq"] })).toBe(false)
  })

  it("requires external fields to be acknowledged", () => {
    const fields: FormField[] = [{ key: "login", type: "external", url: "https://example.com/auth" }]
    const draft = initialDraft(fields)
    expect(evaluateForm(fields, draft).errors.login).toBeDefined()
    draft.login = { ack: true }
    expect(evaluateForm(fields, draft).answer).toEqual({ login: true })
  })
})
