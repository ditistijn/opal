import { useCallback, useEffect, useRef } from "react"
import { ArtifactPanel } from "@/features/artifacts/ArtifactPanel"
import { useDrafts } from "@/features/composer/drafts"
import { ProjectView } from "@/features/projects/ProjectView"
import { ProjectsIndex } from "@/features/projects/ProjectsIndex"
import { SettingsDialog } from "@/features/settings/SettingsDialog"
import { Sidebar } from "@/features/sidebar/Sidebar"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { useElementWidth } from "@/hooks/use-element-width"
import { useFileDrop } from "@/hooks/use-file-drop"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { useIsPhone } from "@/hooks/use-is-phone"
import { PhoneDrawer, usePhoneDrawer } from "@/features/shell/phone-drawer"
import type { SessionInfo } from "@/lib/opencode/types"
import { runtime, type DroppedFile } from "@/lib/runtime"
import { isTauri } from "@/lib/utils"
import { ConversationView } from "./ConversationView"
import { DropOverlay } from "./DropOverlay"
import { HomeView } from "./HomeView"
import { draftKeyFor, useNav } from "./nav-store"
import { SearchPalette } from "./SearchPalette"
import { SplitLayout } from "./SplitLayout"
import "./chat.css"

/** Below this main-column width the artifact pane becomes a "Chat | Artifact" tab instead of a split. */
export const NARROW_WIDTH = 1000

function overlayOpen() {
  return !!document.querySelector('[role="dialog"], [role="menu"], [role="listbox"][data-state="open"]')
}

/** Chat surface: sidebar + home / conversation (+ artifact split) / projects. */
export default function ChatSurface() {
  const view = useNav((s) => s.view)
  const go = useNav((s) => s.go)
  const settingsState = useNav((s) => s.settings)
  const sessionID = view.kind === "session" ? view.sessionID : undefined
  const activity = runtime.useSessionActivity(sessionID)
  const artifacts = runtime.useArtifacts(sessionID)
  const { artifactID, setActive } = runtime.useActiveArtifact(sessionID)

  const newChat = useCallback(() => go({ kind: "home" }), [go])
  const toggleArtifact = useCallback(() => {
    if (!sessionID) return
    if (artifactID) setActive(undefined)
    else if (artifacts.length) setActive(artifacts[artifacts.length - 1].id)
  }, [sessionID, artifactID, artifacts, setActive])

  // Inside Tauri the native menu owns ⌘N / ⌘, / ⌘⇧A and raises events instead (see App.tsx).
  const native = isTauri()
  useEffect(() => {
    const onToggle = () => toggleArtifact()
    window.addEventListener("opal:toggle-artifact", onToggle)
    return () => window.removeEventListener("opal:toggle-artifact", onToggle)
  }, [toggleArtifact])

  useHotkeys([
    { combo: "mod+n", handler: newChat, enabled: !native },
    { combo: "mod+k", handler: () => useNav.getState().setSearchOpen(!useNav.getState().searchOpen) },
    { combo: "mod+,", handler: () => useNav.getState().openSettings(), enabled: !native },
    { combo: "mod+shift+a", handler: toggleArtifact, enabled: !!sessionID && !native },
    {
      combo: "escape",
      allowInInput: true,
      enabled: !!sessionID && activity !== "idle",
      handler: () => {
        if (!overlayOpen() && sessionID) void runtime.interrupt(sessionID)
      },
    },
  ])

  const mainRef = useRef<HTMLElement>(null)
  const onDrop = useCallback((files: DroppedFile[], target: Element | null) => {
    const zone = target?.closest("[data-drop-zone]")?.getAttribute("data-drop-zone")
    if (zone?.startsWith("knowledge:")) {
      void runtime.addProjectKnowledge(zone.slice("knowledge:".length), files)
      return
    }
    useDrafts.getState().addFiles(draftKeyFor(useNav.getState().view), files)
  }, [])
  const dropEnabled = view.kind !== "projects"
  const { dragging, zone } = useFileDrop(mainRef, onDrop, dropEnabled)

  const phone = useIsPhone()
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {phone ? (
        <PhoneDrawer>
          <Sidebar onNewChat={newChat} onClose={() => usePhoneDrawer.getState().setOpen(false)} />
        </PhoneDrawer>
      ) : (
        <Sidebar onNewChat={newChat} />
      )}
      <main ref={mainRef} className="relative flex min-w-0 flex-1 flex-col bg-bg" aria-label="Chat">
        {view.kind === "session" ? (
          <SessionRoute
            sessionID={view.sessionID}
            artifactID={artifactID}
            hasArtifacts={artifacts.length > 0}
            onToggleArtifact={toggleArtifact}
            mainRef={mainRef}
          />
        ) : view.kind === "project" ? (
          <ProjectView projectID={view.projectID} />
        ) : view.kind === "projects" ? (
          <ProjectsIndex />
        ) : (
          <HomeView />
        )}
        {dragging && !zone ? <DropOverlay /> : null}
      </main>
      <SearchPalette />
      <SettingsDialog
        open={settingsState.open}
        onOpenChange={(open) =>
          open ? useNav.getState().openSettings(settingsState.tab) : useNav.getState().closeSettings()
        }
        initialTab={settingsState.tab}
      />
    </div>
  )
}

function SessionRoute({
  sessionID,
  artifactID,
  hasArtifacts,
  onToggleArtifact,
  mainRef,
}: {
  sessionID: string
  artifactID: string | undefined
  hasArtifacts: boolean
  onToggleArtifact(): void
  mainRef: React.RefObject<HTMLElement | null>
}) {
  const session = runtime.useSession(sessionID)
  const width = useElementWidth(mainRef)
  const narrowTab = useNav((s) => s.narrowTab)
  const setNarrowTab = useNav((s) => s.setNarrowTab)
  const go = useNav((s) => s.go)

  if (!session) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-[14px] text-fg-muted">This chat isn't available.</p>
        <Button variant="outline" onClick={() => go({ kind: "home" })}>
          New chat
        </Button>
      </div>
    )
  }

  const chat = (hideHeader?: boolean) => (
    <ConversationView
      key={session.id}
      session={session as SessionInfo}
      artifactOpen={!!artifactID}
      hasArtifacts={hasArtifacts}
      onToggleArtifact={onToggleArtifact}
      hideHeader={hideHeader}
    />
  )

  if (!artifactID) return chat()

  if (width < NARROW_WIDTH) {
    return (
      <Tabs
        value={narrowTab}
        onValueChange={(v) => setNarrowTab(v as "chat" | "artifact")}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex h-11 shrink-0 items-center justify-center border-b border-border">
          <TabsList>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="artifact">Artifact</TabsTrigger>
          </TabsList>
        </div>
        {narrowTab === "chat" ? (
          chat()
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <ArtifactPanel sessionID={session.id} />
          </div>
        )}
      </Tabs>
    )
  }

  return (
    <SplitLayout
      left={chat()}
      right={
        <div className="flex min-h-0 flex-1 flex-col bg-bg-artifact">
          <ArtifactPanel sessionID={session.id} />
        </div>
      }
    />
  )
}
