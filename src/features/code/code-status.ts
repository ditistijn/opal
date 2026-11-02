/**
 * Aggregate status of Code-surface sessions for the title bar indicator. Fed by <CodeStatusReporter>
 * (mounted by the Code surface) — one invisible reporter per session, so it reflects every session,
 * not only rows that are visible in the sidebar.
 */
import { create } from "zustand"
import type { SessionActivity } from "@/lib/runtime"

export type CodeSessionStatus = "idle" | "busy" | "queued" | "permission"

export function sessionStatus(activity: SessionActivity, pendingPermissions: number): CodeSessionStatus {
  if (pendingPermissions > 0) return "permission"
  if (activity === "busy" || activity === "retry") return "busy"
  if (activity === "queued") return "queued"
  return "idle"
}

interface CodeStatusState {
  bySession: Record<string, CodeSessionStatus>
  report(sessionID: string, status: CodeSessionStatus): void
  clear(sessionID: string): void
}

export const useCodeStatus = create<CodeStatusState>((set) => ({
  bySession: {},
  report: (sessionID, status) =>
    set((s) =>
      s.bySession[sessionID] === status ? s : { bySession: { ...s.bySession, [sessionID]: status } },
    ),
  clear: (sessionID) =>
    set((s) => {
      if (!(sessionID in s.bySession)) return s
      const bySession = { ...s.bySession }
      delete bySession[sessionID]
      return { bySession }
    }),
}))

export function summarize(bySession: Record<string, CodeSessionStatus>) {
  let busy = 0
  let permission = 0
  for (const status of Object.values(bySession)) {
    if (status === "busy" || status === "queued") busy++
    else if (status === "permission") permission++
  }
  return { busy, permission }
}
