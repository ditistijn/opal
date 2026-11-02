import {
  Archive,
  ChevronRight,
  Ellipsis,
  FolderGit2,
  FolderOpen,
  FolderTree,
  GitBranch,
  PanelLeft,
  Pencil,
  Plus,
  Settings,
  SquarePen,
  Trash2,
  X,
} from "lucide-react"
import { useMemo, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Tip } from "@/components/ui/tooltip"
import { useNav } from "@/features/chat/nav-store"
import { RenameInput } from "@/features/sidebar/SessionRow"
import { MOD } from "@/features/sidebar/Sidebar"
import type { SessionInfo } from "@/lib/opencode/types"
import { runtime } from "@/lib/runtime"
import { codeRuntime, type RepoEntry } from "@/lib/runtime/code"
import { cn, isTauri } from "@/lib/utils"
import { useCodeNav } from "./code-nav"
import type { CodeSessionStatus } from "./code-status"
import { useSessionCodeStatus } from "./CodeStatusDot"
import { codeSessionTitle, compactRelative } from "./format"
import { groupByRepo, isWorktreeSession, type RepoGroup } from "./group-by-repo"

export async function openFolder() {
  const dir = await runtime.pickDirectory()
  if (!dir?.trim()) return undefined
  const repo = await codeRuntime.openRepo(dir)
  useCodeNav.getState().setHomeRepo(repo.directory)
  return repo
}

/** Groups of the visible (non-archived) code sessions, shared by the sidebar and the surface. */
export function useRepoGroups(): RepoGroup[] {
  const sessions = runtime.useSessions({ surface: "code" })
  const repos = codeRuntime.useRepos()
  const index = codeRuntime.useWorktreeIndex()
  return useMemo(() => groupByRepo(sessions, repos, index, runtime.getOpalMetadata), [sessions, repos, index])
}

export function CodeSidebar() {
  const settings = runtime.useSettings()
  const toggle = () => runtime.updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })
  return settings.sidebarCollapsed ? <Rail onToggle={toggle} /> : <Expanded onToggle={toggle} />
}

const railItem =
  "flex size-8 items-center justify-center rounded-md text-fg-secondary transition-fast hover:bg-bg-inset/70 hover:text-fg [&_svg]:size-[18px]"

function Rail({ onToggle }: { onToggle(): void }) {
  const openNewSession = useCodeNav((s) => s.openNewSession)
  return (
    <aside
      aria-label="Sidebar"
      className="flex w-[var(--sidebar-collapsed-width)] shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-sidebar py-2"
    >
      <Tip label="Open sidebar" side="right">
        <button type="button" className={railItem} onClick={onToggle} aria-label="Open sidebar">
          <PanelLeft />
        </button>
      </Tip>
      <Tip label="New session" shortcut={`${MOD}N`} side="right">
        <button type="button" className={railItem} onClick={() => openNewSession()} aria-label="New session">
          <SquarePen />
        </button>
      </Tip>
      <Tip label="Open folder…" side="right">
        <button
          type="button"
          className={railItem}
          onClick={() => void openFolder()}
          aria-label="Open folder…"
        >
          <FolderOpen />
        </button>
      </Tip>
      <div className="flex-1" />
      <Tip label="Settings" shortcut={`${MOD},`} side="right">
        <button
          type="button"
          className={railItem}
          onClick={() => useNav.getState().openSettings()}
          aria-label="Settings"
        >
          <Settings />
        </button>
      </Tip>
    </aside>
  )
}

function Expanded({ onToggle }: { onToggle(): void }) {
  const groups = useRepoGroups()
  const openNewSession = useCodeNav((s) => s.openNewSession)
  const activeID = useCodeNav((s) => s.sessionID)
  const settings = runtime.useSettings()
  const models = runtime.useModels()
  const [pendingDelete, setPendingDelete] = useState<SessionInfo>()
  const activeRepo = groups.find((g) => g.sessions.some((s) => s.id === activeID))?.repo.directory

  const defaultModel = settings.defaultModel
  const modelName =
    models.find((m) => m.providerID === defaultModel?.providerID && m.id === defaultModel?.id)?.name ??
    defaultModel?.id ??
    "No model"

  return (
    <aside
      aria-label="Sidebar"
      className="flex w-[var(--sidebar-width)] shrink-0 flex-col border-r border-border bg-bg-sidebar"
    >
      <div className="flex h-11 shrink-0 items-center gap-1 px-2">
        <Tip label="Close sidebar" side="bottom">
          <button
            type="button"
            onClick={onToggle}
            aria-label="Close sidebar"
            className="flex size-8 items-center justify-center rounded-md text-fg-secondary transition-fast hover:bg-bg-inset/70 hover:text-fg"
          >
            <PanelLeft className="size-[18px]" />
          </button>
        </Tip>
        <span className="font-serif text-[18px] tracking-[-0.01em] text-fg">Opal</span>
        <span className="ml-1 rounded-sm bg-bg-inset/70 px-1.5 py-px text-[11px] font-medium text-fg-muted">
          Code
        </span>
      </div>

      <div className="px-2">
        <button
          type="button"
          onClick={() => openNewSession(activeRepo)}
          className="group/nav flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-fg transition-colors duration-[120ms] hover:bg-bg-inset/60"
        >
          <span className="-ml-0.5 flex size-[22px] items-center justify-center rounded-full bg-accent text-fg-on-accent">
            <SquarePen className="size-3" strokeWidth={2.4} />
          </span>
          <span className="flex-1 truncate">New session</span>
          <Kbd className="opacity-0 transition-opacity group-hover/nav:opacity-100">{MOD}N</Kbd>
        </button>
      </div>

      <nav className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Repositories">
        <div className="group/sec flex h-7 items-center justify-between px-2.5 pt-1">
          <span className="text-[12px] font-medium text-fg-muted">Repositories</span>
          <Tip label="Open folder…">
            <button
              type="button"
              aria-label="Open folder…"
              onClick={() => void openFolder()}
              className="flex size-5 items-center justify-center rounded-sm text-fg-muted transition-opacity hover:bg-bg-inset hover:text-fg"
            >
              <Plus className="size-3.5" />
            </button>
          </Tip>
        </div>
        {groups.length === 0 ? (
          <div className="px-2.5 py-2">
            <p className="text-[12.5px] text-fg-faint">No repositories yet.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void openFolder()}>
              <FolderOpen />
              Open folder…
            </Button>
          </div>
        ) : (
          groups.map((g) => (
            <RepoSection key={g.repo.directory} group={g} activeID={activeID} onDelete={setPendingDelete} />
          ))
        )}
      </nav>

      <div className="flex h-12 shrink-0 items-center gap-1 border-t border-border px-2">
        <Tip label="Settings" shortcut={`${MOD},`}>
          <button
            type="button"
            aria-label="Settings"
            onClick={() => useNav.getState().openSettings()}
            className="flex size-8 items-center justify-center rounded-md text-fg-secondary transition-fast hover:bg-bg-inset/70 hover:text-fg"
          >
            <Settings className="size-[18px]" />
          </button>
        </Tip>
        <button
          type="button"
          onClick={() => useNav.getState().openSettings("models")}
          className="ml-auto flex h-7 min-w-0 items-center gap-1.5 rounded-full border border-border px-2.5 text-[12px] text-fg-secondary transition-fast hover:bg-bg-inset/60 hover:text-fg"
          title="Default model"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-success" />
          <span className="truncate">{modelName}</span>
        </button>
      </div>

      <DeleteSessionDialog
        session={pendingDelete}
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={() => {
          const s = pendingDelete
          setPendingDelete(undefined)
          if (!s) return
          void runtime.deleteSession(s.id)
          if (useCodeNav.getState().sessionID === s.id) useCodeNav.getState().openSession(undefined)
        }}
      />
    </aside>
  )
}

function RepoSection({
  group,
  activeID,
  onDelete,
}: {
  group: RepoGroup
  activeID: string | undefined
  onDelete(s: SessionInfo): void
}) {
  const { repo, sessions } = group
  const collapsed = useCodeNav((s) => !!s.collapsed[repo.directory])
  const toggleCollapsed = useCodeNav((s) => s.toggleCollapsed)
  const openNewSession = useCodeNav((s) => s.openNewSession)
  const openWorktrees = useCodeNav((s) => s.openWorktrees)
  const [menuOpen, setMenuOpen] = useState(false)
  // Loads worktrees so sessions in them group under this repo (and branch badges resolve).
  codeRuntime.useWorktrees(repo.directory)

  return (
    <section className="mb-1.5" aria-label={repo.name} data-repo={repo.directory}>
      <div className="group/repo relative flex h-8 items-center rounded-md text-fg-secondary hover:bg-bg-inset/50">
        <button
          type="button"
          onClick={() => toggleCollapsed(repo.directory)}
          aria-expanded={!collapsed}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-1.5 pr-16 text-left text-[13px] font-medium text-fg"
          title={repo.directory}
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-fg-muted transition-transform duration-[120ms]",
              !collapsed && "rotate-90",
            )}
          />
          <FolderGit2 className="size-4 shrink-0 text-fg-muted" />
          <span className="truncate">{repo.name}</span>
        </button>
        <div
          className={cn(
            "absolute right-1 flex items-center gap-0.5 transition-opacity duration-[120ms]",
            menuOpen ? "opacity-100" : "opacity-0 group-hover/repo:opacity-100 focus-within:opacity-100",
          )}
        >
          <Tip label={`New session in ${repo.name}`}>
            <button
              type="button"
              aria-label={`New session in ${repo.name}`}
              onClick={() => openNewSession(repo.directory)}
              className="flex size-6 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-inset hover:text-fg"
            >
              <Plus className="size-3.5" />
            </button>
          </Tip>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`More options for ${repo.name}`}
                className="flex size-6 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-inset hover:text-fg"
              >
                <Ellipsis className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[190px]">
              <DropdownMenuItem onSelect={() => openNewSession(repo.directory)}>
                <SquarePen />
                New session
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openWorktrees(repo.directory)}>
                <GitBranch />
                Worktrees…
              </DropdownMenuItem>
              {isTauri() ? (
                <DropdownMenuItem onSelect={() => void runtime.revealPath(repo.directory)}>
                  <FolderOpen />
                  Reveal in Finder
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => codeRuntime.forgetRepo(repo.directory)}>
                <X />
                Remove from list
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {collapsed ? null : sessions.length === 0 ? (
        <button
          type="button"
          onClick={() => openNewSession(repo.directory)}
          className="ml-6 flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-fg-faint hover:text-fg-secondary"
        >
          <Plus className="size-3.5" />
          New session
        </button>
      ) : (
        <div className="space-y-px pl-3" role="list" aria-label={`${repo.name} sessions`}>
          {sessions.map((s) => (
            <CodeSessionRow
              key={s.id}
              session={s}
              repo={repo}
              active={s.id === activeID}
              onDelete={() => onDelete(s)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export function StatusDot({ status, className }: { status: CodeSessionStatus; className?: string }) {
  if (status === "idle") return null
  const label = status === "permission" ? "Needs permission" : status === "queued" ? "Queued" : "Running"
  return (
    <span
      aria-label={label}
      title={label}
      data-status={status}
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        status === "busy" && "animate-pulse bg-accent",
        status === "queued" && "bg-fg-faint",
        status === "permission" && "bg-warning",
        className,
      )}
    />
  )
}

function CodeSessionRow({
  session,
  repo,
  active,
  onDelete,
}: {
  session: SessionInfo
  repo: RepoEntry
  active: boolean
  onDelete(): void
}) {
  const [renaming, setRenaming] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const openSession = useCodeNav((s) => s.openSession)
  const status = useSessionCodeStatus(session.id)
  const index = codeRuntime.useWorktreeIndex()
  const meta = runtime.getOpalMetadata(session)
  const worktree = isWorktreeSession(meta, index)
  const liveBranch = codeRuntime.useBranch(meta.directory)
  const branch = liveBranch ?? (worktree ? meta.worktreeBranch : undefined)
  const title = codeSessionTitle(session)

  if (renaming)
    return (
      <RenameInput
        initial={session.title ?? ""}
        onDone={(t) => {
          setRenaming(false)
          if (t?.trim() && t.trim() !== session.title) void runtime.renameSession(session.id, t.trim())
        }}
      />
    )

  return (
    <div
      role="listitem"
      data-session={session.id}
      data-active={active || undefined}
      className={cn(
        "group/row relative rounded-md transition-colors duration-[120ms]",
        active ? "bg-bg-inset text-fg" : "text-fg-secondary hover:bg-bg-inset/60 hover:text-fg",
      )}
    >
      <button
        type="button"
        onClick={() => openSession(session.id)}
        onDoubleClick={() => setRenaming(true)}
        className="flex w-full min-w-0 flex-col gap-0.5 py-1.5 pl-2.5 pr-8 text-left"
        title={`${title} — ${repo.name}${branch ? ` › ${branch}` : ""}`}
      >
        <span className="flex w-full min-w-0 items-center gap-1.5 text-[13px] leading-[18px]">
          <StatusDot status={status} />
          <span className="truncate">{title}</span>
        </span>
        <span className="flex w-full min-w-0 items-center gap-1.5 text-[11.5px] leading-4 text-fg-muted">
          {status === "permission" ? (
            <span className="truncate text-warning">Needs permission</span>
          ) : branch ? (
            <span
              className="flex min-w-0 items-center gap-1 font-mono text-[11px]"
              aria-label={`${worktree ? "Worktree" : "Local"} branch ${branch}`}
              title={worktree ? "Isolated worktree" : "Repository checkout"}
            >
              {worktree ? (
                <FolderTree className="size-3 shrink-0" />
              ) : (
                <GitBranch className="size-3 shrink-0" />
              )}
              <span className="truncate">{branch}</span>
            </span>
          ) : (
            <span className="truncate text-fg-faint">{worktree ? "Worktree" : "Local"}</span>
          )}
          <span className="ml-auto shrink-0 tabular-nums text-fg-faint">
            {compactRelative(session.time.updated)}
          </span>
        </span>
      </button>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`More options for ${title}`}
            className={cn(
              "absolute right-1 top-1.5 flex size-6 items-center justify-center rounded-sm text-fg-muted transition-opacity duration-[120ms] hover:bg-bg-inset hover:text-fg",
              menuOpen ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
            )}
          >
            <Ellipsis className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[160px]">
          <DropdownMenuItem onSelect={() => setTimeout(() => setRenaming(true), 0)}>
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void runtime.archiveSession(session.id, true)}>
            <Archive />
            Archive
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={onDelete}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function DeleteSessionDialog({
  session,
  onCancel,
  onConfirm,
  children,
}: {
  session: SessionInfo | undefined
  onCancel(): void
  onConfirm(): void
  children?: ReactNode
}) {
  return (
    <Dialog open={!!session} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent hideClose>
        <DialogTitle>Delete session?</DialogTitle>
        <DialogDescription>
          “{codeSessionTitle(session)}” and its transcript will be deleted. Files in the repository and any
          worktree are left untouched.
        </DialogDescription>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} autoFocus>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
