import { FolderOpen, GitBranch } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Tip } from "@/components/ui/tooltip"
import { OpalGlyph } from "@/features/chat/OpalGlyph"
import { Composer } from "@/features/composer/Composer"
import type { ModelRef } from "@/lib/opencode/types"
import { runtime, type ModeID } from "@/lib/runtime"
import { codeRuntime } from "@/lib/runtime/code"
import { cn } from "@/lib/utils"
import { useCodeNav } from "./code-nav"
import { CODE_PLACEHOLDER } from "./CodeSessionView"
import { openFolder } from "./CodeSidebar"
import { RepoPicker } from "./NewSessionDialog"
import { startSession } from "./start-session"

/** Code surface start page: pick a repository and describe the task; a session (and worktree) is created on send. */
export function CodeHome() {
  const settings = runtime.useSettings()
  const repos = codeRuntime.useRepos()
  const homeRepo = useCodeNav((s) => s.homeRepo)
  const setHomeRepo = useCodeNav((s) => s.setHomeRepo)
  const [worktree, setWorktree] = useState(settings.codeSurface.useWorktrees)
  const [mode, setMode] = useState<ModeID>("code")
  const [model, setModel] = useState<ModelRef | undefined>(settings.defaultModel)
  const [error, setError] = useState<string>()
  const [starting, setStarting] = useState(false)
  const repo = repos.some((r) => r.directory === homeRepo) ? homeRepo : repos[0]?.directory

  useEffect(() => setWorktree(settings.codeSurface.useWorktrees), [settings.codeSurface.useWorktrees])

  if (!repos.length)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <OpalGlyph className="size-8" />
        <h1 className="font-serif text-[26px] tracking-[-0.01em] text-fg">Open a repository to start</h1>
        <p className="max-w-sm text-[13.5px] text-fg-muted">
          Sessions run an agent inside a git repository — optionally in an isolated worktree — with a live
          diff and terminal next to the conversation.
        </p>
        <Button variant="accent" onClick={() => void openFolder()}>
          <FolderOpen />
          Open folder…
        </Button>
      </div>
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-[12vh]">
      <div className="mb-6 flex items-center gap-3">
        <OpalGlyph className="size-7" />
        <h1 className="font-serif text-[28px] tracking-[-0.015em] text-fg">What should we build?</h1>
      </div>
      <div className="w-full max-w-[680px]">
        <Composer
          draftKey="code:home"
          placeholder={CODE_PLACEHOLDER}
          activity={starting ? "busy" : "idle"}
          mode={mode}
          onModeChange={setMode}
          model={model}
          onModelChange={setModel}
          autoFocus
          onSubmit={async (prompt) => {
            if (!repo) return
            setError(undefined)
            setStarting(true)
            try {
              await startSession({ repoDirectory: repo, worktree, mode, model, prompt })
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            } finally {
              setStarting(false)
            }
          }}
        />
        <div className="mt-2 flex items-center gap-1 px-1">
          <RepoPicker compact value={repo} onChange={setHomeRepo} className="max-w-64" />
          <Tip
            label={
              worktree ? "Runs on a new branch in an isolated worktree" : "Runs directly in the repository"
            }
          >
            <button
              type="button"
              aria-pressed={worktree}
              aria-label="Isolated worktree"
              onClick={() => setWorktree((v) => !v)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] transition-fast hover:bg-bg-inset/70",
                worktree ? "text-fg" : "text-fg-muted",
              )}
            >
              <GitBranch className="size-3.5" />
              {worktree ? "Isolated worktree" : "Local checkout"}
            </button>
          </Tip>
          {starting ? (
            <span className="ml-auto text-[12px] text-fg-muted" role="status">
              {worktree ? "Creating worktree…" : "Starting…"}
            </span>
          ) : null}
        </div>
        {error ? (
          <div role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  )
}
