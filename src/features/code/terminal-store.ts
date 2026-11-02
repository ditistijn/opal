/** Terminal tabs per Code session. Each tab owns one OpenCode PTY in the session's directory. */
import { create } from "zustand"
import { codeRuntime, type PtyHandle } from "@/lib/runtime/code"

export interface TerminalTab {
  key: string
  title: string
  directory: string
  handle?: PtyHandle
  error?: string
}

interface TerminalState {
  tabs: Record<string, TerminalTab[]>
  active: Record<string, string | undefined>
  /**
   * First visit for a session: re-attaches PTYs still running in `directory` (e.g. after a reload) that no
   * other tab owns, or opens a fresh terminal when there are none.
   */
  ensure(sessionID: string, directory: string): Promise<void>
  /** Opens a new terminal tab (creates the PTY) and makes it active. */
  addTab(sessionID: string, directory: string): Promise<void>
  /** Closes the tab and removes its PTY on the server. */
  closeTab(sessionID: string, key: string): void
  /** Replaces an exited tab's PTY with a fresh one. */
  restartTab(sessionID: string, key: string): Promise<void>
  setActive(sessionID: string, key: string): void
}

let seq = 0

function patchTab(sessionID: string, key: string, patch: Partial<TerminalTab>) {
  useTerminals.setState((s) => ({
    tabs: {
      ...s.tabs,
      [sessionID]: (s.tabs[sessionID] ?? []).map((t) => (t.key === key ? { ...t, ...patch } : t)),
    },
  }))
}

async function spawn(sessionID: string, key: string, directory: string, title: string) {
  try {
    const handle = await codeRuntime.pty.create({ directory, title })
    // The tab may have been closed while the PTY was being created.
    if (!useTerminals.getState().tabs[sessionID]?.some((t) => t.key === key)) {
      await codeRuntime.pty.close(handle)
      return
    }
    patchTab(sessionID, key, { handle, error: undefined })
  } catch (e) {
    patchTab(sessionID, key, { error: e instanceof Error ? e.message : String(e) })
  }
}

const ensuring = new Set<string>()

export const useTerminals = create<TerminalState>((set, get) => ({
  tabs: {},
  active: {},
  async ensure(sessionID, directory) {
    if (get().tabs[sessionID]?.length || ensuring.has(sessionID)) return
    ensuring.add(sessionID)
    try {
      const owned = new Set(
        Object.values(get().tabs)
          .flat()
          .map((t) => t.handle?.id),
      )
      const running = await codeRuntime.pty.list(directory).catch(() => [])
      const adopt = running.filter((h) => !owned.has(h.id))
      if (get().tabs[sessionID]?.length) return
      if (!adopt.length) return void (await get().addTab(sessionID, directory))
      const tabs = adopt.map((handle) => ({ key: `term-${++seq}`, title: handle.title, directory, handle }))
      set((s) => ({
        tabs: { ...s.tabs, [sessionID]: tabs },
        active: { ...s.active, [sessionID]: tabs[tabs.length - 1].key },
      }))
    } finally {
      ensuring.delete(sessionID)
    }
  },
  async addTab(sessionID, directory) {
    const key = `term-${++seq}`
    const taken = new Set((get().tabs[sessionID] ?? []).map((t) => t.title))
    let n = 1
    while (taken.has(`Terminal ${n}`)) n++
    const title = `Terminal ${n}`
    set((s) => ({
      tabs: { ...s.tabs, [sessionID]: [...(s.tabs[sessionID] ?? []), { key, title, directory }] },
      active: { ...s.active, [sessionID]: key },
    }))
    await spawn(sessionID, key, directory, title)
  },
  closeTab(sessionID, key) {
    const list = get().tabs[sessionID] ?? []
    const tab = list.find((t) => t.key === key)
    const rest = list.filter((t) => t.key !== key)
    set((s) => ({
      tabs: { ...s.tabs, [sessionID]: rest },
      active: {
        ...s.active,
        [sessionID]: s.active[sessionID] === key ? rest[rest.length - 1]?.key : s.active[sessionID],
      },
    }))
    if (tab?.handle) void codeRuntime.pty.close(tab.handle)
  },
  async restartTab(sessionID, key) {
    const tab = get().tabs[sessionID]?.find((t) => t.key === key)
    if (!tab) return
    if (tab.handle) void codeRuntime.pty.close(tab.handle)
    patchTab(sessionID, key, { handle: undefined, error: undefined })
    await spawn(sessionID, key, tab.directory, tab.title)
  },
  setActive: (sessionID, key) => set((s) => ({ active: { ...s.active, [sessionID]: key } })),
}))
