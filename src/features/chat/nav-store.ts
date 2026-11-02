/**
 * Chat-surface navigation (home / conversation / project / projects index) and the global
 * overlays (search palette, settings). Mirrored to location.hash so reloads and the
 * dev server keep their place: #/chat/<id>, #/project/<id>, #/projects.
 */
import { create } from "zustand"

export type ChatView =
  | { kind: "home" }
  | { kind: "session"; sessionID: string }
  | { kind: "project"; projectID: string }
  | { kind: "projects" }

export function parseHash(hash: string): ChatView {
  const [, kind, id] = hash.replace(/^#/, "").split("/")
  if (kind === "chat" && id) return { kind: "session", sessionID: decodeURIComponent(id) }
  if (kind === "project" && id) return { kind: "project", projectID: decodeURIComponent(id) }
  if (kind === "projects") return { kind: "projects" }
  return { kind: "home" }
}

export function viewHash(view: ChatView) {
  switch (view.kind) {
    case "session":
      return `#/chat/${encodeURIComponent(view.sessionID)}`
    case "project":
      return `#/project/${encodeURIComponent(view.projectID)}`
    case "projects":
      return "#/projects"
    default:
      return "#/"
  }
}

interface NavState {
  view: ChatView
  /** Project the next "New chat" from home belongs to (set when starting from a project page). */
  go(view: ChatView): void
  searchOpen: boolean
  setSearchOpen(open: boolean): void
  settings: { open: boolean; tab?: string }
  openSettings(tab?: string): void
  closeSettings(): void
  /** Narrow layout: which tab is shown when an artifact is open. */
  narrowTab: "chat" | "artifact"
  setNarrowTab(tab: "chat" | "artifact"): void
}

const initial = typeof location !== "undefined" ? parseHash(location.hash) : ({ kind: "home" } as ChatView)

export const useNav = create<NavState>((set) => ({
  view: initial,
  go(view) {
    set({ view, narrowTab: "chat" })
    if (typeof location !== "undefined" && location.hash !== viewHash(view)) {
      history.pushState(null, "", viewHash(view))
    }
  },
  searchOpen: false,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  settings: { open: false },
  openSettings: (tab) => set({ settings: { open: true, tab } }),
  closeSettings: () => set((s) => ({ settings: { ...s.settings, open: false } })),
  narrowTab: "chat",
  setNarrowTab: (narrowTab) => set({ narrowTab }),
}))

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => useNav.setState({ view: parseHash(location.hash) }))
  window.addEventListener("hashchange", () => useNav.setState({ view: parseHash(location.hash) }))
}

/** Draft key for the composer that is currently visible. */
export function draftKeyFor(view: ChatView) {
  if (view.kind === "session") return view.sessionID
  if (view.kind === "project") return `project:${view.projectID}`
  return "home"
}
