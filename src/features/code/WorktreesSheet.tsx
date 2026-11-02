import { FolderOpen, FolderTree, GitBranch, Loader2, Trash2 } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"
import { Tip } from "@/components/ui/tooltip"
import type { SessionInfo } from "@/lib/opencode/types"
import { runtime } from "@/lib/runtime"
import { codeRuntime, normalizeDir, type WorktreeView } from "@/lib/runtime/code"
import { isTauri } from "@/lib/utils"
import { useCodeNav } from "./code-nav"
import { codeSessionTitle, shortPath } from "./format"

function WorktreeRow({
  repo,
  worktree,
  sessions,
}: {
  repo: string
  worktree: WorktreeView
  sessions: SessionInfo[]
}) {
  const branch = codeRuntime.useBranch(worktree.directory) ?? worktree.branch
  const [confirm, setConfirm] = useState<"normal" | "force">()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const openSession = useCodeNav((s) => s.openSession)

  const remove = async (force: boolean) => {
    setBusy(true)
    setError(undefined)
    try {
      await codeRuntime.removeWorktree(repo, worktree.directory, force)
      setConfirm(undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      // A dirty worktree refuses a normal remove; offer to force it.
      setConfirm("force")
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="px-3 py-2.5" data-worktree={worktree.directory}>
      <div className="flex items-start gap-2.5">
        <FolderTree className="mt-0.5 size-4 shrink-0 text-fg-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-fg">
            <GitBranch className="size-3.5 shrink-0 text-fg-muted" />
            <span className="truncate font-mono text-[12.5px]">{branch ?? "detached"}</span>
          </div>
          <div
            className="selectable truncate font-mono text-[11.5px] text-fg-muted"
            title={worktree.directory}
          >
            {shortPath(worktree.directory, 4)}
          </div>
          {sessions.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    openSession(s.id)
                    useCodeNav.getState().closeWorktrees()
                  }}
                  className="max-w-full truncate rounded-md bg-bg-muted px-1.5 py-0.5 text-[11.5px] text-fg-secondary hover:text-fg"
                >
                  {codeSessionTitle(s)}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-0.5 text-[11.5px] text-fg-faint">No sessions</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {isTauri() ? (
            <Tip label="Open in Finder">
              <Button
                size="icon-sm"
                aria-label="Open in Finder"
                onClick={() => void runtime.revealPath(worktree.directory)}
              >
                <FolderOpen />
              </Button>
            </Tip>
          ) : null}
          <Tip label="Remove worktree">
            <Button
              size="icon-sm"
              aria-label="Remove worktree"
              onClick={() => setConfirm("normal")}
              disabled={busy}
            >
              <Trash2 />
            </Button>
          </Tip>
        </div>
      </div>
      {confirm ? (
        <div className="mt-2 rounded-md border border-border bg-bg-muted px-3 py-2 text-[12.5px]">
          {error ? <div className="mb-1 text-danger">{error}</div> : null}
          <div className="text-fg-secondary">
            {confirm === "force"
              ? "Force removal discards uncommitted changes in this worktree."
              : `Remove this worktree${sessions.length ? ` (used by ${sessions.length} session${sessions.length === 1 ? "" : "s"})` : ""}? Its branch is kept.`}
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="xs" variant="outline" onClick={() => setConfirm(undefined)} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="xs"
              variant="danger"
              onClick={() => void remove(confirm === "force")}
              disabled={busy}
            >
              {busy ? <Loader2 className="animate-spin" /> : null}
              {confirm === "force" ? "Force remove" : "Remove"}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

/** Per-repo worktree manager: directory, branch, sessions using it, Open in Finder, Remove (with force). */
export function WorktreesSheet() {
  const state = useCodeNav((s) => s.worktrees)
  const close = useCodeNav((s) => s.closeWorktrees)
  const repos = codeRuntime.useRepos()
  const repo = state.repo
  const worktrees = codeRuntime.useWorktrees(repo)
  const sessions = runtime.useSessions({ surface: "code" })
  const archived = runtime.useSessions({ surface: "code", archived: true })
  const name = repos.find((r) => r.directory === repo)?.name ?? repo?.split("/").pop()
  const usedBy = (dir: string) =>
    [...sessions, ...archived].filter(
      (s) => normalizeDir(runtime.getOpalMetadata(s).directory ?? "") === normalizeDir(dir),
    )

  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="w-[min(92vw,560px)] p-0" aria-describedby="worktrees-desc">
        <div className="px-5 pb-3 pt-5">
          <DialogTitle>Worktrees · {name}</DialogTitle>
          <DialogDescription id="worktrees-desc">
            Isolated checkouts created for sessions. Removing one deletes its folder; the branch stays in the
            repo.
          </DialogDescription>
        </div>
        <ul
          className="max-h-[50vh] divide-y divide-border overflow-y-auto border-y border-border"
          aria-label="Worktrees"
        >
          {worktrees.length === 0 ? (
            <li className="px-5 py-6 text-center text-[13px] text-fg-muted">
              No worktrees for this repository.
            </li>
          ) : (
            worktrees.map((w) => (
              <WorktreeRow key={w.directory} repo={repo!} worktree={w} sessions={usedBy(w.directory)} />
            ))
          )}
        </ul>
        <DialogFooter className="mt-0 px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => repo && void codeRuntime.refreshWorktrees(repo)}
            className="mr-auto"
          >
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={close}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
