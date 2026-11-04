/**
 * Message projections for opened sessions. Sessions are loaded on first `useMessages`, then kept
 * live from SSE events, applied in frame-sized batches (see ../projection.ts).
 */
import { useEffect } from "react"
import { useStore } from "zustand"
import { createStore } from "zustand/vanilla"
import { whenReady } from "@/lib/opencode/client"
import type { OpenCodeEvent, SessionMessage } from "@/lib/opencode/types"
import type { ChatMessage } from "../contracts"
import {
  PROJECTION_EVENTS,
  applyEvents,
  hasOpenTools,
  projectionFrom,
  projectionFromList,
  settleProjection,
  type Projection,
} from "../projection"
import { getActivity } from "./activity"

interface MessagesState {
  projections: Record<string, Projection>
}

export const messagesStore = createStore<MessagesState>(() => ({ projections: {} }))

const PAGE = 200
const MAX_PAGES = 25
const EMPTY: ChatMessage[] = []
/** Sessions currently loading → events received meanwhile (replayed after the load). */
const loading = new Map<string, OpenCodeEvent[]>()
/** Events waiting for the next frame, per session. */
const pending = new Map<string, OpenCodeEvent[]>()
let flushScheduled = false

export async function fetchAllMessages(sessionID: string): Promise<SessionMessage[]> {
  const client = await whenReady()
  const out: SessionMessage[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    // The server rejects `order` together with `cursor` (400): the cursor already encodes the order.
    const res = await client.message.list(
      cursor ? { sessionID, limit: PAGE, cursor } : { sessionID, order: "asc", limit: PAGE },
    )
    out.push(...res.data)
    const next = res.cursor.next ?? undefined
    if (res.data.length < PAGE || !next || next === cursor) break
    cursor = next
  }
  return out
}

function setProjection(sessionID: string, projection: Projection) {
  messagesStore.setState((s) =>
    s.projections[sessionID] === projection
      ? s
      : { projections: { ...s.projections, [sessionID]: projection } },
  )
}

/** Loads (or reloads) a session's messages, replaying events that arrived during the request. */
export async function loadMessages(sessionID: string): Promise<void> {
  if (loading.has(sessionID)) return
  loading.set(sessionID, [])
  try {
    const list = await fetchAllMessages(sessionID)
    let projection = projectionFromList(list, sessionID)
    const raced = loading.get(sessionID) ?? []
    // Pending frame events are older than nothing we fetched; fold them in too.
    const queued = pending.get(sessionID) ?? []
    pending.delete(sessionID)
    projection = applyEvents(projection, sessionID, [...raced, ...queued])
    if (getActivity(sessionID) === "idle") projection = settleProjection(projection)
    setProjection(sessionID, projection)
  } finally {
    loading.delete(sessionID)
  }
}

export function ensureMessages(sessionID: string) {
  if (messagesStore.getState().projections[sessionID] || loading.has(sessionID)) return
  loadMessages(sessionID).catch((error) =>
    console.warn(`[opal:messages] load ${sessionID} failed`, String(error)),
  )
}

export function isTracked(sessionID: string) {
  return !!messagesStore.getState().projections[sessionID] || loading.has(sessionID)
}

function scheduleFlush() {
  if (flushScheduled) return
  flushScheduled = true
  const run = () => {
    flushScheduled = false
    flushMessages()
  }
  if (typeof requestAnimationFrame === "function" && typeof document !== "undefined" && !document.hidden)
    requestAnimationFrame(run)
  else setTimeout(run, 16)
}

/** Applies all pending events now (one store update). */
export function flushMessages() {
  if (!pending.size) return
  const batches = [...pending.entries()]
  pending.clear()
  messagesStore.setState((s) => {
    let projections = s.projections
    for (const [sessionID, events] of batches) {
      const current = projections[sessionID]
      if (!current) continue
      const next = applyEvents(current, sessionID, events)
      if (next !== current) projections = { ...projections, [sessionID]: next }
    }
    return projections === s.projections ? s : { projections }
  })
}

function sessionOf(event: OpenCodeEvent): string | undefined {
  const data = "data" in event ? (event.data as { sessionID?: unknown } | undefined) : undefined
  return typeof data?.sessionID === "string" ? data.sessionID : undefined
}

export function handleMessageEvent(event: OpenCodeEvent) {
  const sessionID = sessionOf(event)
  if (!sessionID) return
  // Replay-only upstream event (not in the public union): content was replaced → refetch.
  if ((event.type as string) === "session.message.content.updated") {
    if (messagesStore.getState().projections[sessionID]) void loadMessages(sessionID)
    return
  }
  if (!PROJECTION_EVENTS.has(event.type)) return
  const raced = loading.get(sessionID)
  if (raced) {
    raced.push(event)
    return
  }
  const projection = messagesStore.getState().projections[sessionID]
  if (!projection) return
  const queue = pending.get(sessionID)
  if (queue) queue.push(event)
  else pending.set(sessionID, [event])
  scheduleFlush()
  // An execution that ended with tool calls still open means we missed their terminal events.
  if (event.type.startsWith("session.execution.") && event.type !== "session.execution.started") {
    queueMicrotask(() => {
      flushMessages()
      const current = messagesStore.getState().projections[sessionID]
      if (current && hasOpenTools(current)) void loadMessages(sessionID)
    })
  }
}

/** Reloads every opened session (after reconnecting). */
export async function reloadOpenSessions() {
  const ids = Object.keys(messagesStore.getState().projections)
  await Promise.all(ids.map((id) => loadMessages(id).catch(() => undefined)))
}

/** Optimistically shows a user message until the server echoes it (same id). */
export function insertLocalMessage(message: ChatMessage) {
  const current = messagesStore.getState().projections[message.sessionID]
  if (!current || current.index.has(message.id)) return
  setProjection(message.sessionID, projectionFrom([...current.messages, message]))
}

export function removeLocalMessage(sessionID: string, messageID: string) {
  const current = messagesStore.getState().projections[sessionID]
  if (!current?.index.has(messageID)) return
  setProjection(sessionID, projectionFrom(current.messages.filter((m) => m.id !== messageID)))
}

export function getMessages(sessionID: string): ChatMessage[] {
  return messagesStore.getState().projections[sessionID]?.messages ?? EMPTY
}

export function dropMessages(sessionID: string) {
  messagesStore.setState((s) => {
    if (!s.projections[sessionID]) return s
    const projections = { ...s.projections }
    delete projections[sessionID]
    return { projections }
  })
}

export function useMessages(sessionID: string | undefined): ChatMessage[] {
  useEffect(() => {
    if (sessionID) ensureMessages(sessionID)
  }, [sessionID])
  return useStore(messagesStore, (s) => (sessionID ? (s.projections[sessionID]?.messages ?? EMPTY) : EMPTY))
}
