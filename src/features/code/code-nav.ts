/**
 * Code-surface navigation + layout state (active session, right pane, dialogs), persisted in
 * localStorage `opal.code.nav` so reloads keep their place. Kept separate from the chat nav (hash routes).
 */
import { create } from "zustand"

export type PaneTab = "diff" | "terminal" | "subagents" | "files"

const KEY = "opal.code.nav"
export const PANE_MIN = 320
export const PANE_DEFAULT = 460

interface Persisted {
  sessionID?: string
  paneOpen: boolean
  paneTab: PaneTab
  paneWidth: number
  collapsed: Record<string, boolean>
}

interface CodeNavState extends Persisted {
  /** Repo the home composer creates sessions in. */
  homeRepo?: string
  newSession: { open: boolean; repo?: string }
  worktrees: { open: boolean; repo?: string }
  /** File selected from the diff pane's "Open file" (shown by the Files tab). */
  openFile?: { directory: string; path: string }
  /** Child session shown in the Subagents drawer. */
  subagentID?: string
  openSession(sessionID?: string): void
  setPane(open: boolean, tab?: PaneTab): void
  /** ⌘⇧D / ⌘`: open on `tab`, or close when it is already showing. */
  togglePane(tab: PaneTab): void
  setPaneWidth(width: number): void
  toggleCollapsed(repo: string): void
  setHomeRepo(repo?: string): void
  openNewSession(repo?: string): void
  closeNewSession(): void
  openWorktrees(repo: string): void
  closeWorktrees(): void
  showFile(directory: string, path: string): void
  showSubagent(sessionID: string | undefined): void
}

function load(): Persisted {
  const fallback: Persisted = { paneOpen: false, paneTab: "diff", paneWidth: PANE_DEFAULT, collapsed: {} }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Persisted>
    return {
      ...fallback,
      ...raw,
      paneWidth:
        typeof raw.paneWidth === "number" && raw.paneWidth >= PANE_MIN ? raw.paneWidth : PANE_DEFAULT,
      collapsed: raw.collapsed && typeof raw.collapsed === "object" ? raw.collapsed : {},
    }
  } catch {
    return fallback
  }
}

function save(s: Persisted) {
  try {
    const { sessionID, paneOpen, paneTab, paneWidth, collapsed } = s
    localStorage.setItem(KEY, JSON.stringify({ sessionID, paneOpen, paneTab, paneWidth, collapsed }))
  } catch {}
}

export const useCodeNav = create<CodeNavState>((set, get) => ({
  ...load(),
  newSession: { open: false },
  worktrees: { open: false },
  openSession: (sessionID) => set({ sessionID }),
  setPane: (paneOpen, tab) => set((s) => ({ paneOpen, paneTab: tab ?? s.paneTab })),
  togglePane: (tab) => {
    const s = get()
    set(s.paneOpen && s.paneTab === tab ? { paneOpen: false } : { paneOpen: true, paneTab: tab })
  },
  setPaneWidth: (paneWidth) => set({ paneWidth: Math.max(PANE_MIN, Math.round(paneWidth)) }),
  toggleCollapsed: (repo) => set((s) => ({ collapsed: { ...s.collapsed, [repo]: !s.collapsed[repo] } })),
  setHomeRepo: (homeRepo) => set({ homeRepo }),
  openNewSession: (repo) => set({ newSession: { open: true, repo } }),
  closeNewSession: () => set((s) => ({ newSession: { ...s.newSession, open: false } })),
  openWorktrees: (repo) => set({ worktrees: { open: true, repo } }),
  closeWorktrees: () => set((s) => ({ worktrees: { ...s.worktrees, open: false } })),
  showFile: (directory, path) => set({ openFile: { directory, path }, paneOpen: true, paneTab: "files" }),
  showSubagent: (subagentID) =>
    set(subagentID ? { subagentID, paneOpen: true, paneTab: "subagents" } : { subagentID: undefined }),
}))

useCodeNav.subscribe((s, prev) => {
  if (
    s.sessionID !== prev.sessionID ||
    s.paneOpen !== prev.paneOpen ||
    s.paneTab !== prev.paneTab ||
    s.paneWidth !== prev.paneWidth ||
    s.collapsed !== prev.collapsed
  )
    save(s)
})
