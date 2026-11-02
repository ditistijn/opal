import {
  ChevronDown,
  FolderClosed,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Smartphone,
  SquarePen,
} from "lucide-react"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Kbd } from "@/components/ui/kbd"
import { Tip } from "@/components/ui/tooltip"
import { NewProjectDialog } from "@/features/projects/NewProjectDialog"
import type { SessionInfo } from "@/lib/opencode/types"
import { runtime } from "@/lib/runtime"
import { cn, isTauri } from "@/lib/utils"
import { useNav } from "@/features/chat/nav-store"
import { DeleteChatDialog } from "./DeleteChatDialog"
import { groupSessions } from "./group-sessions"
import { SessionRow } from "./SessionRow"

export const MOD = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+"

function SectionHeader({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="group/sec flex h-7 items-center justify-between px-2.5 pt-1">
      <span className="text-[12px] font-medium text-fg-muted">{children}</span>
      {action}
    </div>
  )
}

function NavButton({
  icon,
  label,
  onClick,
  trailing,
  active,
}: {
  icon: ReactNode
  label: string
  onClick(): void
  trailing?: ReactNode
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group/nav flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors duration-[120ms] [&_svg]:size-4 [&_svg]:shrink-0",
        active ? "bg-bg-inset text-fg" : "text-fg hover:bg-bg-inset/60",
      )}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {trailing}
    </button>
  )
}

/** `onClose` = rendered inside the phone drawer: always expanded, its collapse button closes the drawer. */
export function Sidebar({ onNewChat, onClose }: { onNewChat(): void; onClose?(): void }) {
  const settings = runtime.useSettings()
  const collapsed = settings.sidebarCollapsed
  const toggle = () => runtime.updateSettings({ sidebarCollapsed: !collapsed })
  if (onClose) return <Expanded onToggle={onClose} onNewChat={onNewChat} />
  return collapsed ? (
    <Rail onToggle={toggle} onNewChat={onNewChat} />
  ) : (
    <Expanded onToggle={toggle} onNewChat={onNewChat} />
  )
}

function Rail({ onToggle, onNewChat }: { onToggle(): void; onNewChat(): void }) {
  const { go, setSearchOpen, openSettings } = useNav()
  const item =
    "flex size-8 items-center justify-center rounded-md text-fg-secondary transition-fast hover:bg-bg-inset/70 hover:text-fg [&_svg]:size-[18px]"
  return (
    <aside
      aria-label="Sidebar"
      className="flex w-[var(--sidebar-collapsed-width)] shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-sidebar py-2"
    >
      <Tip label="Open sidebar" side="right">
        <button type="button" className={item} onClick={onToggle} aria-label="Open sidebar">
          <PanelLeft />
        </button>
      </Tip>
      <Tip label="New chat" shortcut={`${MOD}N`} side="right">
        <button type="button" className={item} onClick={onNewChat} aria-label="New chat">
          <SquarePen />
        </button>
      </Tip>
      <Tip label="Search" shortcut={`${MOD}K`} side="right">
        <button type="button" className={item} onClick={() => setSearchOpen(true)} aria-label="Search">
          <Search />
        </button>
      </Tip>
      <Tip label="Projects" side="right">
        <button type="button" className={item} onClick={() => go({ kind: "projects" })} aria-label="Projects">
          <FolderClosed />
        </button>
      </Tip>
      <div className="flex-1" />
      <Tip label="Settings" shortcut={`${MOD},`} side="right">
        <button type="button" className={item} onClick={() => openSettings()} aria-label="Settings">
          <Settings />
        </button>
      </Tip>
    </aside>
  )
}

function Expanded({ onToggle, onNewChat }: { onToggle(): void; onNewChat(): void }) {
  const { view, go, setSearchOpen, openSettings } = useNav()
  const settings = runtime.useSettings()
  const sessions = runtime.useSessions({ surface: "chat" })
  const models = runtime.useModels()
  const [newProject, setNewProject] = useState(false)
  useEffect(() => {
    const open = () => setNewProject(true)
    window.addEventListener("opal:new-project", open)
    return () => window.removeEventListener("opal:new-project", open)
  }, [])
  const [showAllProjects, setShowAllProjects] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<SessionInfo>()

  const { starred, groups } = useMemo(() => {
    const starred: SessionInfo[] = []
    const rest: SessionInfo[] = []
    for (const s of sessions) (runtime.getOpalMetadata(s).starred ? starred : rest).push(s)
    return { starred, groups: groupSessions(rest) }
  }, [sessions])

  const activeID = view.kind === "session" ? view.sessionID : undefined
  const projects = [...settings.projects].sort((a, b) => b.updated - a.updated)
  const visibleProjects = showAllProjects ? projects : projects.slice(0, 5)
  const defaultModel = settings.defaultModel
  const modelName =
    models.find((m) => m.providerID === defaultModel?.providerID && m.id === defaultModel?.id)?.name ??
    defaultModel?.id ??
    "No model"

  const row = (s: SessionInfo) => (
    <SessionRow
      key={s.id}
      session={s}
      active={s.id === activeID}
      onOpen={() => go({ kind: "session", sessionID: s.id })}
      onDelete={() => setPendingDelete(s)}
    />
  )

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
      </div>

      <div className="space-y-0.5 px-2">
        <NavButton
          icon={
            <span className="-ml-0.5 flex size-[22px] items-center justify-center rounded-full bg-accent text-fg-on-accent">
              <SquarePen className="!size-3" strokeWidth={2.4} />
            </span>
          }
          label="New chat"
          onClick={onNewChat}
          trailing={<Kbd className="opacity-0 transition-opacity group-hover/nav:opacity-100">{MOD}N</Kbd>}
        />
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-fg-muted transition-colors duration-[120ms] hover:bg-bg-inset/60 hover:text-fg-secondary"
        >
          <Search className="size-4 shrink-0" />
          <span className="flex-1">Search chats</span>
          <Kbd>{MOD}K</Kbd>
        </button>
      </div>

      <nav className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Conversations">
        <SectionHeader
          action={
            <Tip label="New project">
              <button
                type="button"
                aria-label="New project"
                onClick={() => setNewProject(true)}
                className="flex size-5 items-center justify-center rounded-sm text-fg-muted opacity-0 transition-opacity hover:bg-bg-inset hover:text-fg group-hover/sec:opacity-100"
              >
                <Plus className="size-3.5" />
              </button>
            </Tip>
          }
        >
          <button type="button" className="hover:text-fg-secondary" onClick={() => go({ kind: "projects" })}>
            Projects
          </button>
        </SectionHeader>
        <div className="space-y-px">
          {visibleProjects.map((p) => {
            const active = view.kind === "project" && view.projectID === p.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => go({ kind: "project", projectID: p.id })}
                className={cn(
                  "flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] transition-colors duration-[120ms]",
                  active ? "bg-bg-inset text-fg" : "text-fg-secondary hover:bg-bg-inset/60 hover:text-fg",
                )}
              >
                <FolderClosed className="size-4 shrink-0 text-fg-muted" />
                <span className="truncate">{p.name}</span>
              </button>
            )
          })}
          {projects.length > 5 ? (
            <button
              type="button"
              onClick={() => setShowAllProjects((v) => !v)}
              className="flex h-7 w-full items-center gap-1 rounded-md px-2.5 text-[12.5px] text-fg-muted hover:text-fg-secondary"
            >
              <ChevronDown className={cn("size-3.5 transition-transform", showAllProjects && "rotate-180")} />
              {showAllProjects ? "Show less" : `Show ${projects.length - 5} more`}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setNewProject(true)}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] text-fg-muted transition-colors duration-[120ms] hover:bg-bg-inset/60 hover:text-fg-secondary"
          >
            <Plus className="size-4 shrink-0" />
            New project
          </button>
        </div>

        {starred.length ? (
          <section className="mt-4" aria-label="Starred">
            <SectionHeader>Starred</SectionHeader>
            <div className="space-y-px">{starred.map(row)}</div>
          </section>
        ) : null}

        <section className="mt-4" aria-label="Recents">
          <SectionHeader>Recents</SectionHeader>
          {groups.length === 0 ? (
            <p className="px-2.5 py-1 text-[12.5px] text-fg-faint">No chats yet</p>
          ) : (
            groups.map((g) => (
              <div key={g.label} className="mb-2" role="group" aria-label={g.label}>
                <div className="px-2.5 pb-0.5 pt-1.5 text-[11.5px] text-fg-faint">{g.label}</div>
                <div className="space-y-px">{g.sessions.map(row)}</div>
              </div>
            ))
          )}
        </section>
      </nav>

      <div className="flex h-12 shrink-0 items-center gap-1 border-t border-border px-2">
        <Tip label="Settings" shortcut={`${MOD},`}>
          <button
            type="button"
            aria-label="Settings"
            onClick={() => openSettings()}
            className="flex size-8 items-center justify-center rounded-md text-fg-secondary transition-fast hover:bg-bg-inset/70 hover:text-fg"
          >
            <Settings className="size-[18px]" />
          </button>
        </Tip>
        {isTauri() && (
          <Tip label="Remote control…">
            <button
              type="button"
              aria-label="Remote control…"
              onClick={() => openSettings("remote")}
              className="flex size-8 items-center justify-center rounded-md text-fg-secondary transition-fast hover:bg-bg-inset/70 hover:text-fg"
            >
              <Smartphone className="size-[17px]" />
            </button>
          </Tip>
        )}
        <button
          type="button"
          onClick={() => openSettings("models")}
          className="ml-auto flex h-7 min-w-0 items-center gap-1.5 rounded-full border border-border px-2.5 text-[12px] text-fg-secondary transition-fast hover:bg-bg-inset/60 hover:text-fg"
          title="Default model"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-success" />
          <span className="truncate">{modelName}</span>
        </button>
      </div>

      <NewProjectDialog
        open={newProject}
        onOpenChange={setNewProject}
        onCreated={(p) => go({ kind: "project", projectID: p.id })}
      />
      <DeleteChatDialog
        session={pendingDelete}
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={() => {
          const s = pendingDelete
          setPendingDelete(undefined)
          if (!s) return
          void runtime.deleteSession(s.id)
          if (activeID === s.id) go({ kind: "home" })
        }}
      />
    </aside>
  )
}
