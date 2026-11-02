import { Check, ChevronDown, FolderGit2, FolderOpen, GitBranch, Loader2 } from "lucide-react"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ModePicker } from "@/features/composer/ModePicker"
import { ModelSelector } from "@/features/models/ModelSelector"
import type { ModelRef } from "@/lib/opencode/types"
import { runtime, type ModeID } from "@/lib/runtime"
import { codeRuntime } from "@/lib/runtime/code"
import { cn } from "@/lib/utils"
import { useCodeNav } from "./code-nav"
import { openFolder } from "./CodeSidebar"
import { shortPath } from "./format"
import { branchFromTitle, startSession } from "./start-session"

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[12.5px] font-medium text-fg-secondary">{label}</div>
      {children}
      {hint ? <div className="text-[11.5px] text-fg-muted">{hint}</div> : null}
    </div>
  )
}

const pickerTrigger =
  "flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-border-strong bg-bg-elevated px-2.5 text-left text-[13px] text-fg transition-fast hover:bg-bg-muted data-[state=open]:bg-bg-muted"

export function RepoPicker({
  value,
  onChange,
  className,
  compact,
}: {
  value: string | undefined
  onChange(directory: string): void
  className?: string
  compact?: boolean
}) {
  const repos = codeRuntime.useRepos()
  const current = repos.find((r) => r.directory === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Repository: ${current?.name ?? "none"}`}
          className={cn(
            compact
              ? "flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-fg-secondary transition-fast hover:bg-bg-inset/70 hover:text-fg data-[state=open]:bg-bg-inset/70"
              : pickerTrigger,
            className,
          )}
        >
          <FolderGit2 className="size-4 shrink-0 text-fg-muted" />
          <span className="min-w-0 flex-1 truncate">{current?.name ?? "Choose a repository"}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
        <DropdownMenuLabel>Repositories</DropdownMenuLabel>
        {repos.map((r) => (
          <DropdownMenuItem
            key={r.directory}
            onSelect={() => onChange(r.directory)}
            className="h-auto py-1.5"
          >
            <FolderGit2 />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px]">{r.name}</span>
              <span className="truncate font-mono text-[11px] text-fg-muted">
                {shortPath(r.directory, 3)}
              </span>
            </span>
            {r.directory === value ? <Check className="!text-accent" /> : null}
          </DropdownMenuItem>
        ))}
        {repos.length ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem
          onSelect={() =>
            void openFolder().then((repo) => {
              if (repo) onChange(repo.directory)
            })
          }
        >
          <FolderOpen />
          Open folder…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function BranchPicker({
  repo,
  value,
  onChange,
}: {
  repo: string | undefined
  value: string | undefined
  onChange(branch: string): void
}) {
  const [branches, setBranches] = useState<string[]>([])
  const current = codeRuntime.useBranch(repo)
  useEffect(() => {
    if (!repo) return
    let live = true
    codeRuntime
      .listBranches(repo)
      .then((b) => live && setBranches(b))
      .catch(() => live && setBranches([]))
    return () => {
      live = false
    }
  }, [repo])
  const list = useMemo(() => {
    const all = new Set([...(current ? [current] : []), ...branches])
    return [...all]
  }, [branches, current])
  const shown = value ?? current
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Base branch: ${shown ?? "HEAD"}`}
          className={pickerTrigger}
          disabled={!repo}
        >
          <GitBranch className="size-4 shrink-0 text-fg-muted" />
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{shown ?? "HEAD"}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
      >
        {list.length === 0 ? (
          <div className="px-2 py-1.5 text-[12.5px] text-fg-muted">No branches found</div>
        ) : (
          list.map((b) => (
            <DropdownMenuItem key={b} onSelect={() => onChange(b)}>
              <GitBranch />
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{b}</span>
              {b === current ? <span className="text-[11px] text-fg-muted">current</span> : null}
              {b === shown ? <Check className="!text-accent" /> : null}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** ⌘N dialog: repository, optional title, isolated worktree (+ base branch), mode and model. */
export function NewSessionDialog() {
  const state = useCodeNav((s) => s.newSession)
  const close = useCodeNav((s) => s.closeNewSession)
  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && close()}>
      {state.open ? <NewSessionForm initialRepo={state.repo} onDone={close} /> : null}
    </Dialog>
  )
}

function NewSessionForm({ initialRepo, onDone }: { initialRepo?: string; onDone(): void }) {
  const settings = runtime.useSettings()
  const repos = codeRuntime.useRepos()
  const homeRepo = useCodeNav((s) => s.homeRepo)
  const [repo, setRepo] = useState<string | undefined>(initialRepo ?? homeRepo ?? repos[0]?.directory)
  const [title, setTitle] = useState("")
  const [worktree, setWorktree] = useState(settings.codeSurface.useWorktrees)
  const [base, setBase] = useState<string>()
  const [branch, setBranch] = useState("")
  const [mode, setMode] = useState<ModeID>("code")
  const [model, setModel] = useState<ModelRef | undefined>(settings.defaultModel)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!repo && repos[0]) setRepo(repos[0].directory)
  }, [repo, repos])
  useEffect(() => setBase(undefined), [repo])

  const submit = async () => {
    if (!repo || busy) return
    setBusy(true)
    setError(undefined)
    try {
      await startSession({
        repoDirectory: repo,
        worktree,
        baseBranch: base,
        branch: branch.trim() || undefined,
        title,
        mode,
        model,
      })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent className="w-[min(92vw,500px)]" aria-describedby="new-session-desc">
      <DialogTitle>New session</DialogTitle>
      <DialogDescription id="new-session-desc">
        Start an agent session in a repository{worktree ? ", isolated in its own git worktree" : ""}.
      </DialogDescription>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label="Repository">
          <RepoPicker value={repo} onChange={setRepo} />
        </Field>
        <Field label="Title" hint="Optional — generated from your first message otherwise.">
          <Input
            aria-label="Session title"
            value={title}
            placeholder="e.g. Fix flaky auth test"
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </Field>
        <div className="rounded-lg border border-border">
          <label className="flex cursor-default items-start gap-3 px-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] text-fg">Run in an isolated worktree</span>
              <span className="block text-[11.5px] text-fg-muted">
                The agent works on its own branch and checkout, so your working copy stays untouched.
              </span>
            </span>
            <Switch
              checked={worktree}
              onCheckedChange={setWorktree}
              aria-label="Run in an isolated worktree"
            />
          </label>
          {worktree ? (
            <div className="grid grid-cols-2 gap-3 border-t border-border px-3 py-2.5">
              <Field label="Base branch">
                <BranchPicker repo={repo} value={base} onChange={setBase} />
              </Field>
              <Field label="New branch">
                <Input
                  aria-label="New branch"
                  value={branch}
                  placeholder={branchFromTitle(title) ?? "opal/… (auto)"}
                  onChange={(e) => setBranch(e.target.value)}
                  className="font-mono text-[12.5px]"
                />
              </Field>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <ModePicker value={mode} onChange={setMode} />
          <ModelSelector value={model} onChange={setModel} compact />
        </div>
        {error ? (
          <div role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
            {error}
          </div>
        ) : null}
        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onDone} disabled={busy}>
            Cancel
          </Button>
          <Button variant="accent" type="submit" disabled={!repo || busy}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {busy ? (worktree ? "Creating worktree…" : "Creating…") : "Create session"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
