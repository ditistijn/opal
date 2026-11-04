/**
 * The one SSE subscription (`client.event.subscribe()`), fanned out to the stores.
 *
 * The shared stream in @opencode/client does not reconnect by itself: when it ends or errors we
 * resubscribe with backoff (and with the new client after a sidecar restart). Every (re)connection
 * starts with `server.connected`, on which all loaded state is resynced.
 */
import { serverStore, whenReady } from "@/lib/opencode/client"
import type { OpenCodeEvent } from "@/lib/opencode/types"
import { handleActivityEvent, resyncActivity, startActivityPoll } from "./stores/activity"
import { handleArtifactEvent, resyncArtifacts } from "./stores/artifacts"
import { handleCatalogEvent, refreshCatalog } from "./stores/catalog"
import { handleFilesEvent, resyncFiles } from "./stores/files"
import { handleFormEvent, resyncForms } from "./stores/forms"
import { handleMessageEvent, reloadOpenSessions } from "./stores/messages"
import { handlePermissionEvent, resyncPermissions } from "./stores/permissions"
import { handleSessionEvent, loadSessions } from "./stores/sessions"

type Listener = (event: OpenCodeEvent) => void
const listeners = new Set<Listener>()

/** Extra listeners (tests, features that need raw events). Returns an unsubscribe function. */
export function onEvent(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function resync() {
  const tasks: [string, () => Promise<unknown>][] = [
    ["sessions", loadSessions],
    ["catalog", refreshCatalog],
    ["activity", resyncActivity],
    ["messages", reloadOpenSessions],
    ["permissions", resyncPermissions],
    ["forms", resyncForms],
    ["artifacts", resyncArtifacts],
  ]
  await Promise.all(
    tasks.map(([name, task]) =>
      task().catch((error) => console.warn(`[opal:events] resync ${name} failed`, String(error))),
    ),
  )
  resyncFiles()
}

export function dispatch(event: OpenCodeEvent) {
  if (event.type === "server.connected") {
    console.debug("[opal:events] connected")
    void resync()
  } else if (event.type === "location.shutdown") {
    // A config reload cancels pending permissions and forms.
    setTimeout(() => {
      void resyncPermissions().catch(() => undefined)
      void resyncForms().catch(() => undefined)
    }, 500)
  }
  // Activity before messages so a load triggered by a terminal event sees the idle state.
  handleActivityEvent(event)
  handleSessionEvent(event)
  handleMessageEvent(event)
  handlePermissionEvent(event)
  handleFormEvent(event)
  handleCatalogEvent(event)
  handleArtifactEvent(event)
  handleFilesEvent(event)
  for (const listener of listeners) listener(event)
}

let running = false

export function startEventLoop() {
  if (running) return
  running = true
  startActivityPoll()
  void (async () => {
    for (let attempt = 0; ;) {
      const client = await whenReady()
      const epoch = serverStore.getState().epoch
      const controller = new AbortController()
      const unsubscribe = serverStore.subscribe((s) => {
        if (s.epoch !== epoch) controller.abort()
      })
      try {
        for await (const event of client.event.subscribe({ signal: controller.signal })) {
          attempt = 0
          dispatch(event)
        }
      } catch (error) {
        if (!controller.signal.aborted) console.debug("[opal:events] stream ended", String(error))
      } finally {
        unsubscribe()
      }
      if (serverStore.getState().epoch === epoch) {
        await new Promise((r) => setTimeout(r, Math.min(250 * 2 ** attempt, 10_000)))
        attempt++
      }
    }
  })()
}
