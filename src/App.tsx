import { Suspense, lazy, useEffect, useRef } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useTheme } from "@/hooks/use-theme"
import { useSurface } from "@/hooks/use-surface"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { ServerGate } from "@/features/shell/ServerGate"
import { TitleBar } from "@/features/shell/TitleBar"
import { useNav } from "@/features/chat/nav-store"
import { UpdateBanner } from "@/features/shell/UpdateBanner"
import { onMenuEvents } from "@/lib/native/menu-events"
import { startAutoUpdateChecks, useUpdates } from "@/lib/native/update-store"
import { runtime } from "@/lib/runtime"
import { isTauri } from "@/lib/utils"

const ChatSurface = lazy(() => import("@/features/chat/ChatSurface"))
const CodeSurface = lazy(() => import("@/features/code/CodeSurface"))

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: 1 } },
})

/**
 * In-app signals the native menu (and browser shortcuts) raise for features that own the state:
 *   "opal:new-project"      → Sidebar opens the New project dialog
 *   "opal:toggle-artifact"  → ChatSurface toggles the artifact pane for the open conversation
 */
export const APP_SIGNALS = { newProject: "opal:new-project", toggleArtifact: "opal:toggle-artifact" } as const

function signal(name: string) {
  window.dispatchEvent(new CustomEvent(name))
}

export default function App() {
  useTheme()
  const { surface, setSurface } = useSurface()
  const settings = runtime.useSettings()
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    document.documentElement.dataset.surface = surface
  }, [surface])

  // Native macOS menu → app actions (no-op outside Tauri).
  useEffect(
    () =>
      onMenuEvents({
        "menu:settings": () => useNav.getState().openSettings(),
        "menu:check-updates": () => {
          useNav.getState().openSettings("about")
          void useUpdates.getState().check({ silent: false })
        },
        "menu:new-chat": () => {
          void runtime.updateSettings({ lastSurface: "chat" })
          useNav.getState().go({ kind: "home" })
        },
        "menu:new-project": () => {
          void runtime.updateSettings({ lastSurface: "chat" })
          signal(APP_SIGNALS.newProject)
        },
        "menu:toggle-sidebar": () =>
          void runtime.updateSettings({ sidebarCollapsed: !settingsRef.current.sidebarCollapsed }),
        "menu:toggle-artifact-panel": () => signal(APP_SIGNALS.toggleArtifact),
        "menu:surface": (next) => void runtime.updateSettings({ lastSurface: next }),
      }),
    [],
  )

  // Over-the-air updates: silent check ~8 s after launch and every 6 h while enabled (desktop only).
  // A found update only shows the UpdateBanner; installing always needs the user's click.
  const autoCheckUpdates = settings.updates.autoCheck
  useEffect(() => {
    if (!isTauri() || !autoCheckUpdates) return
    return startAutoUpdateChecks()
  }, [autoCheckUpdates])

  // Browser build only: AppKit owns these key equivalents inside Tauri.
  useHotkeys([
    { combo: "mod+1", handler: () => setSurface("chat"), enabled: !isTauri() },
    { combo: "mod+2", handler: () => setSurface("code"), enabled: !isTauri() },
  ])

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400}>
        <div className="flex h-full w-full flex-col overflow-hidden bg-bg text-fg">
          <TitleBar />
          <ServerGate>
            <Suspense fallback={<div className="flex-1" />}>
              {surface === "code" ? <CodeSurface /> : <ChatSurface />}
            </Suspense>
          </ServerGate>
          <UpdateBanner />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
