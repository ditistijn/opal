/** Groups Code-surface sessions under the repository they belong to (worktree sessions under their repo). */
import type { SessionInfo } from "@/lib/opencode/types"
import type { OpalSessionMetadata } from "@/lib/runtime"
import { normalizeDir, repoName, type RepoEntry } from "@/lib/runtime/code"

export interface RepoGroup {
  repo: RepoEntry
  sessions: SessionInfo[]
}

/** The repo directory a session belongs to: metadata → known worktree → its own directory. */
export function repoOf(meta: OpalSessionMetadata, worktreeIndex: Record<string, string>) {
  if (meta.repoDirectory) return normalizeDir(meta.repoDirectory)
  const dir = meta.directory ? normalizeDir(meta.directory) : ""
  return worktreeIndex[dir] ?? dir
}

/** True when the session runs in a directory other than its repo root (an isolated worktree). */
export function isWorktreeSession(meta: OpalSessionMetadata, worktreeIndex: Record<string, string>) {
  const dir = meta.directory ? normalizeDir(meta.directory) : ""
  return !!dir && repoOf(meta, worktreeIndex) !== dir
}

/**
 * Known repos keep their order (opened folders first) and appear even without sessions; sessions in
 * unknown directories form extra groups after them, most recently active first. Sessions are assumed
 * to be sorted by `time.updated` desc already.
 */
export function groupByRepo(
  sessions: SessionInfo[],
  repos: RepoEntry[],
  worktreeIndex: Record<string, string>,
  meta: (s: SessionInfo) => OpalSessionMetadata,
): RepoGroup[] {
  const groups = new Map<string, RepoGroup>()
  for (const repo of repos) groups.set(normalizeDir(repo.directory), { repo, sessions: [] })
  const extra: RepoGroup[] = []
  for (const s of sessions) {
    const dir = repoOf(meta(s), worktreeIndex)
    if (!dir) continue
    let group = groups.get(dir)
    if (!group) {
      group = { repo: { directory: dir, name: repoName(dir) }, sessions: [] }
      groups.set(dir, group)
      extra.push(group)
    }
    group.sessions.push(s)
  }
  const known = repos.map((r) => groups.get(normalizeDir(r.directory))!).filter(Boolean)
  return [...known, ...extra]
}
