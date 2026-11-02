import type { SessionInfo } from "@/lib/opencode/types"

export type RecentGroup = "Today" | "Yesterday" | "Previous 7 days" | "Older"
export const GROUP_ORDER: RecentGroup[] = ["Today", "Yesterday", "Previous 7 days", "Older"]

function startOfDay(ms: number) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Calendar-day bucket for a timestamp relative to `now` (local time). */
export function groupFor(ms: number, now = Date.now()): RecentGroup {
  const today = startOfDay(now)
  if (ms >= today) return "Today"
  const yesterday = today - 86_400_000
  if (ms >= yesterday) return "Yesterday"
  if (ms >= today - 7 * 86_400_000) return "Previous 7 days"
  return "Older"
}

/** Groups sessions (newest first within each group) by last activity, skipping empty groups. */
export function groupSessions(sessions: SessionInfo[], now = Date.now()) {
  const buckets = new Map<RecentGroup, SessionInfo[]>()
  for (const s of [...sessions].sort((a, b) => b.time.updated - a.time.updated)) {
    const g = groupFor(s.time.updated, now)
    const list = buckets.get(g) ?? []
    list.push(s)
    buckets.set(g, list)
  }
  return GROUP_ORDER.filter((g) => buckets.has(g)).map((g) => ({ label: g, sessions: buckets.get(g)! }))
}

export function sessionTitle(s: Pick<SessionInfo, "title"> | undefined) {
  return s?.title?.trim() || "New chat"
}
