import type { SessionInfo } from "@/lib/opencode/types"

export function codeSessionTitle(s: Pick<SessionInfo, "title"> | undefined) {
  return s?.title?.trim() || "New session"
}

/** "/Users/me/…/worktree/abc/rate-limit" style shortening for chips. */
export function shortPath(path: string, keep = 2) {
  const home = path.replace(/^\/Users\/[^/]+/, "~")
  const parts = home.split("/").filter(Boolean)
  if (parts.length <= keep + 1) return home
  return `${home.startsWith("~") ? "~/" : "/"}…/${parts.slice(-keep).join("/")}`
}

export function compactRelative(ms: number, now = Date.now()) {
  const m = Math.floor(Math.max(0, now - ms) / 60_000)
  if (m < 1) return "now"
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  if (d < 60) return `${Math.floor(d / 7)}w`
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function slugify(input: string) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32)
      .replace(/-+$/, "") || "work"
  )
}
