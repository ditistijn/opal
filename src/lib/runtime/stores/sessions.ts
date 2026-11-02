/** Session list/info store, kept current from `session.*` events. */
import { useEffect } from "react"
import { useStore } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { createStore } from "zustand/vanilla"
import { getClient, whenReady } from "@/lib/opencode/client"
import type { OpenCodeEvent, SessionInfo } from "@/lib/opencode/types"
import type { OpalSessionMetadata, Surface } from "../contracts"

interface SessionsState {
  byID: Record<string, SessionInfo>
  loaded: boolean
}

export const sessionsStore = createStore<SessionsState>(() => ({ byID: {}, loaded: false }))

const PAGE = 100
const MAX_PAGES = 50
const childLoads = new Set<string>()
const EMPTY: SessionInfo[] = []

export function getOpalMetadata(session: SessionInfo): OpalSessionMetadata {
  const raw = session.metadata?.opal
  const opal =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Partial<OpalSessionMetadata>) : {}
  return {
    ...opal,
    surface: opal.surface === "chat" || opal.surface === "code" ? opal.surface : "code",
    directory: opal.directory ?? session.location.directory,
  }
}

export function getSession(sessionID: string): SessionInfo | undefined {
  return sessionsStore.getState().byID[sessionID]
}

export async function fetchSession(sessionID: string): Promise<SessionInfo> {
  const session = await (await whenReady()).session.get({ sessionID })
  upsertSession(session)
  return session
}

export async function requireSession(sessionID: string): Promise<SessionInfo> {
  return getSession(sessionID) ?? fetchSession(sessionID)
}

export function upsertSession(session: SessionInfo) {
  sessionsStore.setState((s) => ({ byID: { ...s.byID, [session.id]: session } }))
}

export function patchSession(sessionID: string, patch: (session: SessionInfo) => SessionInfo) {
  sessionsStore.setState((s) => {
    const current = s.byID[sessionID]
    return current ? { byID: { ...s.byID, [sessionID]: patch(current) } } : s
  })
}

export function removeSession(sessionID: string) {
  sessionsStore.setState((s) => {
    if (!s.byID[sessionID]) return s
    const byID = { ...s.byID }
    delete byID[sessionID]
    return { byID }
  })
}

async function listAll(input: { archived?: boolean; parentID?: string }) {
  const client = getClient()
  const out: SessionInfo[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await client.session.list({ ...input, limit: PAGE, order: "desc", cursor })
    out.push(...res.data)
    const next = res.cursor.next ?? undefined
    if (res.data.length < PAGE || !next || next === cursor) break
    cursor = next
  }
  return out
}

/** (Re)loads all root sessions, archived included. */
export async function loadSessions() {
  await whenReady()
  const [active, archived] = await Promise.all([listAll({ archived: false }), listAll({ archived: true })])
  const byID: Record<string, SessionInfo> = {}
  // Keep already-loaded child sessions; roots are replaced by the fresh lists.
  for (const s of Object.values(sessionsStore.getState().byID)) if (s.parentID) byID[s.id] = s
  for (const s of [...active, ...archived]) byID[s.id] = s
  sessionsStore.setState({ byID, loaded: true })
}

export async function loadChildSessions(parentID: string) {
  await whenReady()
  const children = await listAll({ parentID })
  sessionsStore.setState((s) => {
    const byID = { ...s.byID }
    for (const child of children) byID[child.id] = child
    return { byID }
  })
}

function refetch(sessionID: string) {
  fetchSession(sessionID).catch((error) =>
    console.debug(`[opal:sessions] refetch ${sessionID} failed`, String(error)),
  )
}

export function handleSessionEvent(event: OpenCodeEvent) {
  switch (event.type) {
    case "session.created":
    case "session.forked":
    case "session.moved":
    case "session.permissions":
      return refetch(event.data.sessionID)
    case "session.renamed":
      return patchSession(event.data.sessionID, (s) => ({ ...s, title: event.data.title }))
    case "session.deleted":
      return removeSession(event.data.sessionID)
    case "session.archived":
      return patchSession(event.data.sessionID, (s) => ({
        ...s,
        time: { ...s.time, archived: event.created },
      }))
    case "session.unarchived":
      return patchSession(event.data.sessionID, (s) => {
        const { archived: _archived, ...time } = s.time
        return { ...s, time }
      })
    case "session.model.selected":
      return patchSession(event.data.sessionID, (s) => ({ ...s, model: event.data.model }))
    case "session.agent.selected":
      return patchSession(event.data.sessionID, (s) => ({ ...s, agent: event.data.agent }))
    case "session.metadata.updated":
      return patchSession(event.data.sessionID, (s) => ({ ...s, metadata: event.data.metadata }))
    case "session.usage.updated":
      return patchSession(event.data.sessionID, (s) => ({
        ...s,
        cost: event.data.cost,
        tokens: event.data.tokens,
      }))
    case "session.execution.started":
      return patchSession(event.data.sessionID, (s) => ({
        ...s,
        time: { ...s.time, busy: event.created, updated: event.created },
      }))
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted":
      return patchSession(event.data.sessionID, (s) => ({
        ...s,
        time: { ...s.time, idle: event.created, updated: event.created },
      }))
    default:
      return
  }
}

export interface SessionFilter {
  surface: Surface
  projectID?: string
  search?: string
  archived?: boolean
}

export function selectSessions(byID: Record<string, SessionInfo>, filter: SessionFilter): SessionInfo[] {
  const search = filter.search?.trim().toLowerCase()
  const archived = filter.archived ?? false
  return Object.values(byID)
    .filter((s) => {
      if (s.parentID) return false
      if (!!s.time.archived !== archived) return false
      const meta = getOpalMetadata(s)
      if (meta.surface !== filter.surface) return false
      if (filter.projectID !== undefined && meta.projectID !== filter.projectID) return false
      if (search && !(s.title ?? "").toLowerCase().includes(search)) return false
      return true
    })
    .sort((a, b) => b.time.updated - a.time.updated || (a.id < b.id ? -1 : 1))
}

export function useSessions(filter: SessionFilter): SessionInfo[] {
  return useStore(
    sessionsStore,
    useShallow((s) => selectSessions(s.byID, filter)),
  )
}

export function useSession(sessionID: string | undefined): SessionInfo | undefined {
  const session = useStore(sessionsStore, (s) => (sessionID ? s.byID[sessionID] : undefined))
  const loaded = useStore(sessionsStore, (s) => s.loaded)
  useEffect(() => {
    if (sessionID && loaded && !getSession(sessionID)) refetch(sessionID)
  }, [sessionID, loaded])
  return session
}

export function useChildSessions(parentID: string | undefined): SessionInfo[] {
  useEffect(() => {
    if (!parentID || childLoads.has(parentID)) return
    childLoads.add(parentID)
    loadChildSessions(parentID).catch(() => childLoads.delete(parentID))
  }, [parentID])
  return useStore(
    sessionsStore,
    useShallow((s) =>
      parentID
        ? Object.values(s.byID)
            .filter((x) => x.parentID === parentID)
            .sort((a, b) => a.time.created - b.time.created)
        : EMPTY,
    ),
  )
}

export function resetChildLoads() {
  childLoads.clear()
}
