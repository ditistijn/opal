/** Pending permission requests per session (`permission.asked` / `permission.replied`). */
import { useEffect } from "react"
import { useStore } from "zustand"
import { createStore } from "zustand/vanilla"
import { whenReady } from "@/lib/opencode/client"
import type { OpenCodeEvent, PermissionRequest } from "@/lib/opencode/types"

interface PermissionsState {
  bySession: Record<string, PermissionRequest[]>
}

export const permissionsStore = createStore<PermissionsState>(() => ({ bySession: {} }))

const EMPTY: PermissionRequest[] = []
const watched = new Set<string>()

function set(sessionID: string, list: PermissionRequest[]) {
  permissionsStore.setState((s) => ({ bySession: { ...s.bySession, [sessionID]: list } }))
}

export async function loadPermissions(sessionID: string) {
  const list = await (await whenReady()).permission.list({ sessionID })
  set(sessionID, list)
}

export function removePermission(sessionID: string, requestID: string) {
  const list = permissionsStore.getState().bySession[sessionID]
  if (list?.some((r) => r.id === requestID))
    set(
      sessionID,
      list.filter((r) => r.id !== requestID),
    )
}

export function handlePermissionEvent(event: OpenCodeEvent) {
  if (event.type === "permission.asked") {
    const request = event.data as PermissionRequest
    const list = permissionsStore.getState().bySession[request.sessionID] ?? EMPTY
    if (!list.some((r) => r.id === request.id)) set(request.sessionID, [...list, request])
  } else if (event.type === "permission.replied") {
    removePermission(event.data.sessionID, event.data.requestID)
  }
}

export async function resyncPermissions() {
  const ids = new Set([...watched, ...Object.keys(permissionsStore.getState().bySession)])
  await Promise.all([...ids].map((id) => loadPermissions(id).catch(() => undefined)))
}

export async function replyPermission(
  sessionID: string,
  requestID: string,
  decision: "once" | "always" | "reject",
) {
  await (await whenReady()).permission.reply({ sessionID, requestID, decision })
  removePermission(sessionID, requestID)
}

export function usePermissions(sessionID: string | undefined): PermissionRequest[] {
  useEffect(() => {
    if (!sessionID || watched.has(sessionID)) return
    watched.add(sessionID)
    loadPermissions(sessionID).catch(() => watched.delete(sessionID))
  }, [sessionID])
  return useStore(permissionsStore, (s) => (sessionID ? (s.bySession[sessionID] ?? EMPTY) : EMPTY))
}
