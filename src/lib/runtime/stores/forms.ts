/**
 * Pending forms per session (`form.created` / `form.replied` / `form.cancelled`).
 *
 * OpenCode's `question` tool (and MCP elicitation) asks the user through a form and blocks the turn until
 * it is answered (`session.form.reply`) or dismissed (`session.form.cancel`). Forms are ephemeral on the
 * server, so pending ones are listed again on session open and after every (re)connection.
 */
import { useEffect } from "react"
import { useStore } from "zustand"
import { createStore } from "zustand/vanilla"
import { whenReady } from "@/lib/opencode/client"
import type { FormAnswer, FormInfo, OpenCodeEvent } from "@/lib/opencode/types"

export type FormsBySession = Record<string, FormInfo[]>

interface FormsState {
  bySession: FormsBySession
}

export const formsStore = createStore<FormsState>(() => ({ bySession: {} }))

const EMPTY: FormInfo[] = []
const watched = new Set<string>()

function without(state: FormsBySession, sessionID: string, formID: string): FormsBySession {
  const list = state[sessionID]
  if (!list?.some((f) => f.id === formID)) return state
  return { ...state, [sessionID]: list.filter((f) => f.id !== formID) }
}

/** Pure reducer for form events; returns the same object when nothing changed. */
export function reduceForms(state: FormsBySession, event: OpenCodeEvent): FormsBySession {
  if (event.type === "form.created") {
    const form = event.data.form as FormInfo
    const list = state[form.sessionID] ?? EMPTY
    if (list.some((f) => f.id === form.id)) return state
    return { ...state, [form.sessionID]: [...list, form] }
  }
  if (event.type === "form.replied" || event.type === "form.cancelled")
    return without(state, event.data.sessionID, event.data.id)
  return state
}

function set(sessionID: string, list: FormInfo[]) {
  formsStore.setState((s) => ({ bySession: { ...s.bySession, [sessionID]: list } }))
}

// LIMITATION: forms owned by OpenCode's "global" sentinel (MCP elicitation) are never listed or shown.
export async function loadForms(sessionID: string) {
  const list = await (await whenReady()).session.form.list({ sessionID })
  set(sessionID, list)
}

export function handleFormEvent(event: OpenCodeEvent) {
  const prev = formsStore.getState().bySession
  const next = reduceForms(prev, event)
  if (next !== prev) formsStore.setState({ bySession: next })
}

export async function resyncForms() {
  const ids = new Set([...watched, ...Object.keys(formsStore.getState().bySession)])
  await Promise.all([...ids].map((id) => loadForms(id).catch(() => undefined)))
}

function remove(sessionID: string, formID: string) {
  const prev = formsStore.getState().bySession
  const next = without(prev, sessionID, formID)
  if (next !== prev) formsStore.setState({ bySession: next })
}

export async function replyForm(sessionID: string, formID: string, answer: FormAnswer) {
  await (await whenReady()).session.form.reply({ sessionID, formID, answer })
  remove(sessionID, formID)
}

export async function cancelForm(sessionID: string, formID: string, message?: string) {
  await (await whenReady()).session.form.cancel({ sessionID, formID, ...(message ? { message } : {}) })
  remove(sessionID, formID)
}

export function useForms(sessionID: string | undefined): FormInfo[] {
  useEffect(() => {
    if (!sessionID || watched.has(sessionID)) return
    watched.add(sessionID)
    loadForms(sessionID).catch(() => watched.delete(sessionID))
  }, [sessionID])
  return useStore(formsStore, (s) => (sessionID ? (s.bySession[sessionID] ?? EMPTY) : EMPTY))
}
