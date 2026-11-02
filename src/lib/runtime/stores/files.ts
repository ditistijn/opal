/** Files in a session's working directory (sandbox / repo), refreshed after each step and on idle. */
import { useEffect } from "react"
import { useStore } from "zustand"
import { createStore } from "zustand/vanilla"
import { whenReady } from "@/lib/opencode/client"
import type { FileDiff, OpenCodeEvent } from "@/lib/opencode/types"
import { isTauri } from "@/lib/utils"
import { native, type NativeFileEntry } from "../native"
import { getOpalMetadata, requireSession } from "./sessions"

interface FilesState {
  files: Record<string, NativeFileEntry[]>
  diffs: Record<string, FileDiff[]>
}

export const filesStore = createStore<FilesState>(() => ({ files: {}, diffs: {} }))

const EMPTY_FILES: NativeFileEntry[] = []
const EMPTY_DIFFS: FileDiff[] = []
const watchedFiles = new Set<string>()
const watchedDiffs = new Set<string>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

export async function refreshFiles(sessionID: string) {
  // LIMITATION: the plain-browser build cannot walk the local filesystem; the list stays empty there.
  if (!isTauri()) return
  const session = await requireSession(sessionID)
  const directory = getOpalMetadata(session).directory
  if (!directory) return
  const files = await native.listSessionFiles(directory)
  filesStore.setState((s) => ({ files: { ...s.files, [sessionID]: files } }))
}

export async function refreshDiff(sessionID: string) {
  const diff = await (await whenReady()).session.diff({ sessionID })
  filesStore.setState((s) => ({ diffs: { ...s.diffs, [sessionID]: diff } }))
}

function schedule(sessionID: string) {
  clearTimeout(timers.get(sessionID))
  timers.set(
    sessionID,
    setTimeout(() => {
      timers.delete(sessionID)
      if (watchedFiles.has(sessionID)) void refreshFiles(sessionID).catch(() => undefined)
      if (watchedDiffs.has(sessionID)) void refreshDiff(sessionID).catch(() => undefined)
    }, 250),
  )
}

export function handleFilesEvent(event: OpenCodeEvent) {
  switch (event.type) {
    case "session.step.ended":
    case "session.step.failed":
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted":
    case "session.revert.committed":
      return schedule(event.data.sessionID)
    default:
      return
  }
}

export function resyncFiles() {
  for (const id of new Set([...watchedFiles, ...watchedDiffs])) schedule(id)
}

export function useSessionFiles(sessionID: string | undefined): NativeFileEntry[] {
  useEffect(() => {
    if (!sessionID) return
    watchedFiles.add(sessionID)
    void refreshFiles(sessionID).catch(() => undefined)
  }, [sessionID])
  return useStore(filesStore, (s) => (sessionID ? (s.files[sessionID] ?? EMPTY_FILES) : EMPTY_FILES))
}

export function useSessionDiff(sessionID: string | undefined): FileDiff[] {
  useEffect(() => {
    if (!sessionID) return
    watchedDiffs.add(sessionID)
    void refreshDiff(sessionID).catch(() => undefined)
  }, [sessionID])
  return useStore(filesStore, (s) => (sessionID ? (s.diffs[sessionID] ?? EMPTY_DIFFS) : EMPTY_DIFFS))
}
