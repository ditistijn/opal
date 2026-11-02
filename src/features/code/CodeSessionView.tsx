import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  FolderGit2,
  FolderTree,
  GitBranch,
  PanelRight,
  Square,
} from "lucide-react"
import { useState, type CSSProperties } from "react"
import { Button } from "@/components/ui/button"
import { Tip } from "@/components/ui/tooltip"
import { MessageList } from "@/features/chat/MessageList"
import { PermissionCard } from "@/features/chat/PermissionCard"
import { QuestionCard } from "@/features/chat/QuestionCard"
import { ToolRowContext } from "@/features/chat/ToolRow"
import { Composer } from "@/features/composer/Composer"
import { modeInfo } from "@/features/composer/modes"
import { RenameInput } from "@/features/sidebar/SessionRow"
import { MOD } from "@/features/sidebar/Sidebar"
import { useCopy } from "@/hooks/use-copy"
import type { SessionInfo } from "@/lib/opencode/types"
import { runtime } from "@/lib/runtime"
import { codeRuntime } from "@/lib/runtime/code"
import { cn, isTauri } from "@/lib/utils"
import { useCodeNav } from "./code-nav"
import { codeSessionTitle, shortPath } from "./format"
import { isWorktreeSession, repoOf } from "./group-by-repo"
import { RightPane } from "./RightPane"
import { codeToolExtension } from "./tool-detail"

export const CODE_PLACEHOLDER = "Describe what to build or fix…"

function useSessionPlace(session: SessionInfo) {
  const index = codeRuntime.useWorktreeIndex()
  const repos = codeRuntime.useRepos()
  const meta = runtime.getOpalMetadata(session)
  const directory = meta.directory ?? session.location.directory
  const repoDir = repoOf(meta, index)
  const worktree = isWorktreeSession(meta, index)
  const repo = repos.find((r) => r.directory === repoDir)
  const liveBranch = codeRuntime.useBranch(directory)
  return {
    meta,
    directory,
    worktree,
    repoName: repo?.name ?? repoDir.split("/").pop() ?? repoDir,
    branch: liveBranch ?? meta.worktreeBranch,
  }
}

function ModelLabel({ session }: { session: SessionInfo }) {
  const models = runtime.useModels()
  const ref = session.model
  const name = ref
    ? (models.find((m) => m.providerID === ref.providerID && m.id === ref.id)?.name ?? ref.id)
    : undefined
  const mode = modeInfo(runtime.getOpalMetadata(session).mode ?? "code")
  return (
    <span className="hidden min-w-0 shrink truncate text-[12px] text-fg-muted @3xl:inline">
      {mode.label}
      {name ? ` · ${name}` : ""}
    </span>
  )
}

// LIMITATION: the browser build cannot reveal folders in Finder, so the chip copies the path instead.
function WorktreeChip({ directory }: { directory: string }) {
  const { copied, copy } = useCopy()
  const desktop = isTauri()
  return (
    <Tip
      label={
        desktop ? `Reveal in Finder — ${directory}` : copied ? "Copied path" : `Copy path — ${directory}`
      }
    >
      <button
        type="button"
        aria-label={desktop ? "Reveal worktree in Finder" : "Copy worktree path"}
        onClick={() => (desktop ? void runtime.revealPath(directory) : void copy(directory))}
        className="hidden h-6 min-w-0 max-w-56 shrink items-center gap-1 rounded-md border border-border px-1.5 font-mono text-[11px] text-fg-muted transition-fast hover:bg-bg-muted hover:text-fg @2xl:flex"
      >
        <FolderTree className="size-3 shrink-0" />
        <span className="truncate">{shortPath(directory)}</span>
      </button>
    </Tip>
  )
}

function SessionHeader({ session }: { session: SessionInfo }) {
  const [renaming, setRenaming] = useState(false)
  const activity = runtime.useSessionActivity(session.id)
  const { directory, worktree, repoName, branch } = useSessionPlace(session)
  const paneOpen = useCodeNav((s) => s.paneOpen)
  const togglePane = useCodeNav((s) => s.togglePane)
  const setPane = useCodeNav((s) => s.setPane)
  const archived = !!session.time.archived
  const title = codeSessionTitle(session)

  return (
    <header
      className="@container flex h-11 shrink-0 items-center gap-2 border-b border-border px-3"
      aria-label="Session"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {renaming ? (
          <div className="w-72 shrink-0">
            <RenameInput
              initial={session.title ?? ""}
              onDone={(t) => {
                setRenaming(false)
                if (t?.trim() && t.trim() !== session.title) void runtime.renameSession(session.id, t.trim())
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRenaming(true)}
            title="Rename"
            className="min-w-0 shrink truncate rounded-md px-1.5 py-0.5 text-left text-[13.5px] font-medium text-fg transition-fast hover:bg-bg-muted"
          >
            {title}
          </button>
        )}
        <span className="hidden min-w-0 shrink-[2] items-center gap-1 text-[12px] text-fg-muted @lg:flex">
          <FolderGit2 className="size-3.5 shrink-0" />
          <span className="truncate">{repoName}</span>
          {branch ? (
            <>
              <ChevronRight className="size-3 shrink-0 text-fg-faint" />
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate font-mono text-[11.5px]">{branch}</span>
            </>
          ) : null}
        </span>
        {worktree ? <WorktreeChip directory={directory} /> : null}
      </div>
      <ModelLabel session={session} />
      {activity !== "idle" ? (
        <Tip label="Stop" shortcut="Esc">
          <Button
            size="xs"
            variant="outline"
            onClick={() => void runtime.interrupt(session.id)}
            aria-label="Stop session"
          >
            <Square className="!size-2.5 fill-current" />
            Stop
          </Button>
        </Tip>
      ) : null}
      <Tip label={archived ? "Unarchive" : "Archive"}>
        <Button
          size="icon-sm"
          aria-label={archived ? "Unarchive session" : "Archive session"}
          onClick={() => {
            void runtime.archiveSession(session.id, !archived)
            if (!archived) useCodeNav.getState().openSession(undefined)
          }}
        >
          {archived ? <ArchiveRestore /> : <Archive />}
        </Button>
      </Tip>
      <Tip label={paneOpen ? "Hide panel" : "Show diff"} shortcut={`${MOD}⇧D`}>
        <Button
          size="icon-sm"
          aria-label={paneOpen ? "Hide panel" : "Show panel"}
          aria-pressed={paneOpen}
          onClick={() => (paneOpen ? setPane(false) : togglePane("diff"))}
          className={cn(paneOpen && "bg-bg-inset/70 text-fg")}
        >
          <PanelRight />
        </Button>
      </Tip>
    </header>
  )
}

function EmptyTranscript({ repoName, worktree }: { repoName: string; worktree: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
      <p className="font-serif text-[22px] tracking-[-0.01em] text-fg">What should we work on?</p>
      <p className="text-[13px] text-fg-muted">
        The agent works in <span className="text-fg-secondary">{repoName}</span>
        {worktree ? " on its own isolated worktree" : ""}. Edits and commands ask for permission.
      </p>
    </div>
  )
}

/** One Code session: header, agent transcript, inline question/permission prompts, composer, and the right pane. */
export function CodeSessionView({ session }: { session: SessionInfo }) {
  const messages = runtime.useMessages(session.id)
  const activity = runtime.useSessionActivity(session.id)
  const permissions = runtime.usePermissions(session.id)
  const forms = runtime.useForms(session.id)
  const paneOpen = useCodeNav((s) => s.paneOpen)
  const { meta, directory, worktree, repoName, branch } = useSessionPlace(session)
  const busy = activity !== "idle"
  const visible = messages.some((m) => m.role === "user" || m.role === "assistant")

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col"
        style={{ "--content-max-width": "820px" } as CSSProperties}
        data-testid="code-session"
      >
        <SessionHeader session={session} />
        {visible || busy ? (
          <ToolRowContext.Provider value={codeToolExtension}>
            <MessageList messages={messages} busy={busy} />
          </ToolRowContext.Provider>
        ) : (
          <EmptyTranscript repoName={repoName} worktree={worktree} />
        )}
        <div className="mx-auto w-full max-w-[var(--content-max-width)] shrink-0 px-5 pb-3">
          <Composer
            draftKey={`code:${session.id}`}
            placeholder={CODE_PLACEHOLDER}
            activity={activity}
            sessionID={session.id}
            mode={meta.mode ?? "code"}
            onModeChange={(m) => runtime.setSessionMode(session.id, m)}
            model={session.model}
            onModelChange={(m) => runtime.setSessionModel(session.id, m)}
            onSubmit={(input) => runtime.sendPrompt(session.id, input)}
            onStop={() => runtime.interrupt(session.id)}
            autoFocus
            above={
              forms.length || permissions.length ? (
                <>
                  {forms.length ? (
                    <div aria-label="Questions">
                      {forms.map((f, i) => (
                        <QuestionCard key={f.id} form={f} shortcuts={i === 0 && !permissions.length} />
                      ))}
                    </div>
                  ) : null}
                  {permissions.length ? (
                    <div aria-label="Permission requests">
                      {permissions.map((p, i) => (
                        <PermissionCard key={p.id} request={p} variant="code" shortcuts={i === 0} />
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null
            }
          />
          <p className="mt-1.5 flex min-w-0 items-center justify-center gap-1.5 text-[11px] text-fg-faint">
            <span className="truncate font-mono" title={directory}>
              {shortPath(directory, 3)}
            </span>
            {branch ? (
              <>
                <span>·</span>
                <span className="truncate font-mono">{branch}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>
      {paneOpen ? <RightPane sessionID={session.id} directory={directory} /> : null}
    </div>
  )
}
