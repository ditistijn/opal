/**
 * Artifacts per session + views (kind, preview URL, version history) + the active artifact.
 *
 * Change detection: `session.tool.success` of an `artifact_*` tool (name learned from
 * `session.tool.input.started`) and session idle re-list the session's artifacts; any artifact whose
 * `time.updated` moved gets a version snapshot (Rust `cmd_snapshot_artifact`, or an in-memory list
 * in the browser) and becomes the session's active artifact.
 */
import { useCallback, useEffect, useMemo } from "react"
import { useStore } from "zustand"
import { createStore } from "zustand/vanilla"
import { detectKind } from "@/lib/artifacts/kind"
import { previewURL as buildPreviewURL } from "@/lib/artifacts/url"
import { whenReady } from "@/lib/opencode/client"
import type { ArtifactContent, ArtifactInfo, OpenCodeEvent } from "@/lib/opencode/types"
import { isTauri } from "@/lib/utils"
import type { ArtifactKind, ArtifactVersion, ArtifactView } from "../contracts"
import { native } from "../native"
import { getOpalMetadata, getSession, requireSession } from "./sessions"

interface ArtifactsState {
  bySession: Record<string, ArtifactInfo[]>
  views: Record<string, ArtifactView>
  /** Active artifact per session: an id, `null` when the user closed the pane, `undefined` when never chosen (→ newest). */
  active: Record<string, string | null | undefined>
}

export const artifactsStore = createStore<ArtifactsState>(() => ({ bySession: {}, views: {}, active: {} }))

const EMPTY: ArtifactInfo[] = []
const toolNames = new Map<string, string>()
const loads = new Map<string, Promise<void>>()
const contentCache = new Map<string, { updated: number; content: ArtifactContent }>()
/** artifactID → time.updated of the newest snapshot we know about. */
const snapshotted = new Map<string, number>()
/** Browser-mode version history (Tauri keeps snapshots on disk via versions.rs). */
const memoryVersions = new Map<string, { version: ArtifactVersion; files: Record<string, string> }[]>()

function locationFor(sessionID: string | undefined) {
  const session = sessionID ? getSession(sessionID) : undefined
  const directory = session ? getOpalMetadata(session).directory : undefined
  return directory ? { directory } : undefined
}

export function previewFor(info: ArtifactInfo, kind: ArtifactKind): string {
  try {
    return buildPreviewURL(info, kind, { nonce: info.time.updated })
  } catch {
    return `artifact://localhost/${info.id}/${info.entry}`
  }
}

export async function getArtifactContent(artifactID: string): Promise<ArtifactContent> {
  const view = artifactsStore.getState().views[artifactID]
  const cached = contentCache.get(artifactID)
  if (cached && view && cached.updated === view.info.time.updated) return cached.content
  const client = await whenReady()
  const res = await client.experimental.artifacts.get({
    artifactID,
    location: locationFor(view?.info.sessionID),
  })
  contentCache.set(artifactID, { updated: res.data.info.time.updated, content: res.data })
  return res.data
}

async function listVersions(info: ArtifactInfo): Promise<ArtifactVersion[]> {
  if (isTauri()) return native.listArtifactVersions(info.id)
  return (memoryVersions.get(info.id) ?? []).map((v) => v.version)
}

async function snapshot(info: ArtifactInfo): Promise<void> {
  if (isTauri()) {
    await native.snapshotArtifact(info.id, info.title)
  } else {
    const content = await getArtifactContent(info.id)
    const list = memoryVersions.get(info.id) ?? []
    const n = (list.at(-1)?.version.n ?? 0) + 1
    list.push({
      version: { n, time: info.time.updated, path: `memory://${info.id}/${n}`, title: info.title },
      files: { ...content.files },
    })
    memoryVersions.set(info.id, list)
  }
  snapshotted.set(info.id, info.time.updated)
}

function setView(info: ArtifactInfo, versions?: ArtifactVersion[]) {
  artifactsStore.setState((s) => {
    const previous = s.views[info.id]
    const cachedFiles = contentCache.get(info.id)?.content.files
    const kind = detectKind(info.entry, cachedFiles)
    const view: ArtifactView = {
      info,
      kind,
      previewURL: previewFor(info, kind),
      versions: versions ?? previous?.versions ?? [],
    }
    return { views: { ...s.views, [info.id]: view } }
  })
}

/** Snapshots a new/changed artifact (once per `time.updated`) and refreshes its version list. */
async function syncVersions(info: ArtifactInfo) {
  try {
    let versions = await listVersions(info)
    const known = snapshotted.get(info.id) ?? Math.max(0, ...versions.map((v) => v.time))
    if (!versions.length || info.time.updated > known) {
      await snapshot(info)
      versions = await listVersions(info)
    } else snapshotted.set(info.id, known)
    setView(info, versions)
  } catch (error) {
    console.debug(`[opal:artifacts] versions for ${info.id} unavailable`, String(error))
  }
}

/** Lists a session's artifacts; with `live`, new or updated artifacts become active. */
export function loadArtifacts(sessionID: string, live = false): Promise<void> {
  const running = loads.get(sessionID)
  if (running) return running.then(() => (live ? loadArtifacts(sessionID, live) : undefined))
  const task = (async () => {
    await requireSession(sessionID).catch(() => undefined)
    const client = await whenReady()
    const res = await client.experimental.artifacts.list({ sessionID })
    const list = [...res.data].sort((a, b) => a.time.created - b.time.created)
    const state = artifactsStore.getState()
    const before = new Map((state.bySession[sessionID] ?? []).map((a) => [a.id, a.time.updated]))
    const firstLoad = !state.bySession[sessionID]
    const changed = list.filter((a) => before.get(a.id) !== a.time.updated)
    artifactsStore.setState((s) => ({ bySession: { ...s.bySession, [sessionID]: list } }))
    for (const info of list) setView(info)
    const newest = changed.at(-1)
    if (live && !firstLoad && newest)
      artifactsStore.setState((s) => ({ active: { ...s.active, [sessionID]: newest.id } }))
    await Promise.all(changed.map(syncVersions))
  })()
  loads.set(sessionID, task)
  return task.finally(() => loads.delete(sessionID))
}

export async function updateArtifact(artifactID: string, files: Record<string, string>, title?: string) {
  const view = artifactsStore.getState().views[artifactID]
  const sessionID = view?.info.sessionID
  const client = await whenReady()
  await client.experimental.artifacts.update({
    artifactID,
    files,
    title,
    sessionID,
    location: locationFor(sessionID),
  })
  contentCache.delete(artifactID)
  if (sessionID) await loadArtifacts(sessionID)
}

export async function restoreArtifactVersion(artifactID: string, n: number) {
  const view = artifactsStore.getState().views[artifactID]
  const version = view?.versions.find((v) => v.n === n)
  const files = isTauri()
    ? await native.readArtifactVersion(artifactID, n)
    : memoryVersions.get(artifactID)?.find((v) => v.version.n === n)?.files
  if (!files) throw new Error(`Version ${n} of ${artifactID} not found`)
  await updateArtifact(artifactID, files, version?.title)
}

function sessionOf(event: OpenCodeEvent) {
  const data = "data" in event ? (event.data as { sessionID?: unknown }) : undefined
  return typeof data?.sessionID === "string" ? data.sessionID : undefined
}

export function handleArtifactEvent(event: OpenCodeEvent) {
  const sessionID = sessionOf(event)
  if (!sessionID) return
  switch (event.type) {
    case "session.tool.input.started":
      toolNames.set(event.data.id, event.data.name)
      return
    case "session.tool.success":
    case "session.tool.failed": {
      const name = toolNames.get(event.data.id)
      toolNames.delete(event.data.id)
      if (event.type === "session.tool.success" && name && /^(opencode_)?artifact_/.test(name))
        void loadArtifacts(sessionID, true).catch(() => undefined)
      return
    }
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted":
      if (artifactsStore.getState().bySession[sessionID])
        void loadArtifacts(sessionID, true).catch(() => undefined)
      return
    default:
      return
  }
}

export async function resyncArtifacts() {
  await Promise.all(
    Object.keys(artifactsStore.getState().bySession).map((id) => loadArtifacts(id).catch(() => undefined)),
  )
}

export function useArtifacts(sessionID: string | undefined): ArtifactInfo[] {
  useEffect(() => {
    if (sessionID && !artifactsStore.getState().bySession[sessionID])
      void loadArtifacts(sessionID).catch(() => undefined)
  }, [sessionID])
  return useStore(artifactsStore, (s) => (sessionID ? (s.bySession[sessionID] ?? EMPTY) : EMPTY))
}

export function useArtifact(artifactID: string | undefined): ArtifactView | undefined {
  const view = useStore(artifactsStore, (s) => (artifactID ? s.views[artifactID] : undefined))
  useEffect(() => {
    if (!artifactID || artifactsStore.getState().views[artifactID]) return
    getArtifactContent(artifactID)
      .then((content) => syncVersions(content.info))
      .catch(() => undefined)
  }, [artifactID])
  return view
}

export function setActiveArtifact(sessionID: string, artifactID: string | undefined) {
  // `undefined` from the UI means "close the pane"; keep that as null so the newest-artifact default does not reopen it.
  artifactsStore.setState((s) => ({ active: { ...s.active, [sessionID]: artifactID ?? null } }))
}

/** A conversation opens with its most recent artifact showing until the user closes the pane. */
export function useActiveArtifact(sessionID: string | undefined) {
  const artifactID = useStore(artifactsStore, (s) => {
    if (!sessionID) return undefined
    const chosen = s.active[sessionID]
    if (chosen !== undefined) return chosen ?? undefined
    return s.bySession[sessionID]?.at(-1)?.id
  })
  const setActive = useCallback(
    (id?: string) => {
      if (sessionID) setActiveArtifact(sessionID, id)
    },
    [sessionID],
  )
  return useMemo(() => ({ artifactID, setActive }), [artifactID, setActive])
}
