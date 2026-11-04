import { useMemo } from "react"
import { useNav } from "@/features/chat/nav-store"
import { SettingsDialog } from "@/features/settings/SettingsDialog"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { runtime } from "@/lib/runtime"
import { useCodeNav } from "./code-nav"
import { CodeHome } from "./CodeHome"
import { CodeSessionView } from "./CodeSessionView"
import { CodeSidebar, useRepoGroups } from "./CodeSidebar"
import { CodeStatusReporter } from "./CodeStatusDot"
import { NewSessionDialog } from "./NewSessionDialog"
import { WorktreesSheet } from "./WorktreesSheet"
import "./code.css"

function overlayOpen() {
  // Only overlays that are actually open: closed/animating Radix content and inline cards (questions,
  // subagent transcripts) also carry role="dialog" and must not swallow Esc-to-interrupt.
  return !!document.querySelector(
    ':is([role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"])[data-state="open"]',
  )
}

/**
 * Agentic coding surface: repositories → sessions sidebar, the agent session (transcript, inline
 * permissions, composer) and a right pane with Diff / Terminal / Subagents / Files.
 */
export default function CodeSurface() {
  const sessionID = useCodeNav((s) => s.sessionID)
  const session = runtime.useSession(sessionID)
  const permissions = runtime.usePermissions(sessionID)
  const sessions = runtime.useSessions({ surface: "code" })
  const groups = useRepoGroups()
  const settingsState = useNav((s) => s.settings)
  const sessionIDs = useMemo(() => sessions.map((s) => s.id), [sessions])
  const activeRepo = groups.find((g) => g.sessions.some((s) => s.id === sessionID))?.repo.directory
  const nav = useCodeNav.getState

  useHotkeys([
    { combo: "mod+n", handler: () => nav().openNewSession(activeRepo ?? nav().homeRepo) },
    { combo: "mod+shift+d", enabled: !!session, handler: () => nav().togglePane("diff") },
    { combo: "mod+`", enabled: !!session, handler: () => nav().togglePane("terminal") },
    { combo: "mod+,", handler: () => useNav.getState().openSettings() },
    {
      combo: "escape",
      allowInInput: true,
      // With a pending permission, Esc belongs to the permission card (Deny).
      // Not gated on local activity: it can be stale, and interrupt() asks the server when unsure.
      enabled: !!session && permissions.length === 0,
      handler: () => {
        if (!overlayOpen() && sessionID) void runtime.interrupt(sessionID)
      },
    },
  ])

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden" data-surface="code">
      <CodeSidebar />
      <main className="relative flex min-w-0 flex-1 flex-col bg-bg" aria-label="Code">
        {session ? <CodeSessionView key={session.id} session={session} /> : <CodeHome />}
      </main>
      <NewSessionDialog />
      <WorktreesSheet />
      <SettingsDialog
        open={settingsState.open}
        onOpenChange={(open) =>
          open ? useNav.getState().openSettings(settingsState.tab) : useNav.getState().closeSettings()
        }
        initialTab={settingsState.tab}
      />
      <CodeStatusReporter sessionIDs={sessionIDs} />
    </div>
  )
}
