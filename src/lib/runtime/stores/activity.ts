/** Per-session activity (idle / busy / retry / queued) + the prompt concurrency limiter. */
import { useStore } from "zustand"
import { createStore } from "zustand/vanilla"
import { whenReady } from "@/lib/opencode/client"
import type { OpenCodeEvent } from "@/lib/opencode/types"
import type { SessionActivity } from "../contracts"
import { Limiter } from "../limiter"
import { settingsStore } from "./settings"

type ServerActivity = Exclude<SessionActivity, "queued">

interface ActivityState {
  server: Record<string, ServerActivity>
  queued: Record<string, true>
}

export const activityStore = createStore<ActivityState>(() => ({ server: {}, queued: {} }))

export const limiter = new Limiter({
  max: () => settingsStore.getState().settings.maxConcurrentConnections,
  onChange: () =>
    activityStore.setState({ queued: Object.fromEntries(limiter.queuedSessions().map((id) => [id, true])) }),
  log: (line) => console.debug(`[opal:limiter] ${line}`),
})

/** Sessions whose prompt was admitted but whose execution has not been observed yet. */
const watchdogs = new Map<string, ReturnType<typeof setTimeout>>()
const WATCHDOG_MS = 30_000

function setServerActivity(sessionID: string, activity: ServerActivity) {
  const current = activityStore.getState().server[sessionID] ?? "idle"
  if (current === activity) return
  console.debug(`[opal:activity] ${sessionID} ${current} → ${activity}`)
  activityStore.setState((s) => ({ server: { ...s.server, [sessionID]: activity } }))
}

export function getActivity(sessionID: string): SessionActivity {
  const s = activityStore.getState()
  return s.queued[sessionID] ? "queued" : (s.server[sessionID] ?? "idle")
}

function clearWatchdog(sessionID: string) {
  const timer = watchdogs.get(sessionID)
  if (timer) clearTimeout(timer)
  watchdogs.delete(sessionID)
}

function settleIdle(sessionID: string) {
  clearWatchdog(sessionID)
  setServerActivity(sessionID, "idle")
  limiter.release(sessionID)
}

/**
 * After a prompt is admitted we expect `session.execution.started`; if the session never becomes
 * active (e.g. the prompt was merged into a turn that just finished) the slot is released.
 */
export function armWatchdog(sessionID: string) {
  clearWatchdog(sessionID)
  watchdogs.set(
    sessionID,
    setTimeout(async () => {
      watchdogs.delete(sessionID)
      if (activityStore.getState().server[sessionID] === "busy") return
      try {
        const active = await (await whenReady()).session.active()
        if (!active[sessionID]) settleIdle(sessionID)
      } catch {
        settleIdle(sessionID)
      }
    }, WATCHDOG_MS),
  )
}

export function releaseSession(sessionID: string) {
  settleIdle(sessionID)
}

export function handleActivityEvent(event: OpenCodeEvent) {
  switch (event.type) {
    case "session.execution.started":
      clearWatchdog(event.data.sessionID)
      return setServerActivity(event.data.sessionID, "busy")
    case "session.step.started":
      if (activityStore.getState().server[event.data.sessionID] === "retry")
        setServerActivity(event.data.sessionID, "busy")
      return
    case "session.retry.scheduled":
      return setServerActivity(event.data.sessionID, "retry")
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted":
      return settleIdle(event.data.sessionID)
    case "session.status": {
      const status = event.data.status.type
      if (status === "idle") return settleIdle(event.data.sessionID)
      clearWatchdog(event.data.sessionID)
      return setServerActivity(event.data.sessionID, status)
    }
    default:
      return
  }
}

/** Resync from `session.active()` after (re)connecting. */
export async function resyncActivity() {
  const active = await (await whenReady()).session.active()
  const known = activityStore.getState().server
  for (const id of Object.keys(known)) if (!active[id] && known[id] !== "idle") settleIdle(id)
  for (const id of Object.keys(active)) setServerActivity(id, "busy")
}

export function useSessionActivity(sessionID: string | undefined): SessionActivity {
  return useStore(activityStore, (s) => {
    if (!sessionID) return "idle"
    return s.queued[sessionID] ? "queued" : (s.server[sessionID] ?? "idle")
  })
}
