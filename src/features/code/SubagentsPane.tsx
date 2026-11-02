import { ChevronRight, Network, X } from "lucide-react"
import { useState } from "react"
import { MessageList } from "@/features/chat/MessageList"
import type { SessionInfo } from "@/lib/opencode/types"
import { runtime } from "@/lib/runtime"
import { cn } from "@/lib/utils"
import { StatusDot } from "./CodeSidebar"
import { sessionStatus } from "./code-status"
import { codeSessionTitle, compactRelative } from "./format"

function useModelName(session: SessionInfo) {
  const models = runtime.useModels()
  const ref = session.model
  if (!ref) return undefined
  return models.find((m) => m.providerID === ref.providerID && m.id === ref.id)?.name ?? ref.id
}

function SubagentNode({
  session,
  depth,
  onOpen,
  selected,
}: {
  session: SessionInfo
  depth: number
  onOpen(s: SessionInfo): void
  selected?: string
}) {
  const [open, setOpen] = useState(true)
  const children = runtime.useChildSessions(session.id)
  const activity = runtime.useSessionActivity(session.id)
  const status = sessionStatus(activity, 0)
  const model = useModelName(session)
  return (
    <li
      role="treeitem"
      aria-expanded={children.length ? open : undefined}
      aria-selected={selected === session.id}
    >
      <div
        className={cn(
          "group/sub flex h-12 items-center gap-1.5 rounded-md pr-2 transition-colors duration-[120ms]",
          selected === session.id ? "bg-bg-inset/70" : "hover:bg-bg-muted",
        )}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        {children.length ? (
          <button
            type="button"
            aria-label={open ? "Collapse" : "Expand"}
            onClick={() => setOpen((v) => !v)}
            className="flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:text-fg"
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform duration-[120ms]", open && "rotate-90")}
            />
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onOpen(session)}
          className="flex min-w-0 flex-1 flex-col text-left"
        >
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-fg">
            <Network className="size-3.5 shrink-0 text-fg-muted" />
            <span className="truncate">{codeSessionTitle(session)}</span>
            <StatusDot status={status} />
          </span>
          <span className="flex min-w-0 items-center gap-1.5 pl-5 text-[11.5px] text-fg-muted">
            <span className="truncate">{model ?? "Default model"}</span>
            {session.agent ? <span className="shrink-0 text-fg-faint">· {session.agent}</span> : null}
            <span className="ml-auto shrink-0 tabular-nums text-fg-faint">
              {status === "idle" ? compactRelative(session.time.updated) : "running"}
            </span>
          </span>
        </button>
      </div>
      {open && children.length ? (
        <ul role="group">
          {children.map((c) => (
            <SubagentNode key={c.id} session={c} depth={depth + 1} onOpen={onOpen} selected={selected} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/** Read-only transcript of a subagent (child session), over the right pane. */
export function SubagentDrawer({ session, onClose }: { session: SessionInfo; onClose(): void }) {
  const messages = runtime.useMessages(session.id)
  const activity = runtime.useSessionActivity(session.id)
  const model = useModelName(session)
  return (
    <div
      role="dialog"
      aria-label={`Subagent: ${codeSessionTitle(session)}`}
      className="opal-fade-in absolute inset-0 z-10 flex flex-col bg-bg"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <Network className="size-4 shrink-0 text-fg-muted" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-fg">{codeSessionTitle(session)}</div>
        </div>
        <span className="shrink-0 truncate text-[11.5px] text-fg-muted">{model}</span>
        <button
          type="button"
          aria-label="Close subagent transcript"
          onClick={onClose}
          autoFocus
          className="flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-muted hover:text-fg"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col [--content-max-width:100%]">
        <MessageList messages={messages} busy={activity !== "idle"} readOnly />
      </div>
    </div>
  )
}

/** Subagents tab: the tree of child sessions spawned by the `subagent` tool. */
export function SubagentsPane({
  sessionID,
  openID,
  onOpen,
}: {
  sessionID: string
  openID?: string
  onOpen(id: string | undefined): void
}) {
  const children = runtime.useChildSessions(sessionID)
  const open = runtime.useSession(openID)
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="subagents-pane">
      {children.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
          <Network className="size-5 text-fg-faint" />
          <p className="text-[13px] text-fg-secondary">No subagents yet</p>
          <p className="text-[12px] text-fg-muted">Tasks the agent delegates to subagents appear here.</p>
        </div>
      ) : (
        <ul role="tree" aria-label="Subagents" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {children.map((c) => (
            <SubagentNode key={c.id} session={c} depth={0} onOpen={(s) => onOpen(s.id)} selected={openID} />
          ))}
        </ul>
      )}
      {open ? <SubagentDrawer session={open} onClose={() => onOpen(undefined)} /> : null}
    </div>
  )
}
