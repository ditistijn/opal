/**
 * Code-surface runtime: the extra hooks/actions the Code surface needs on top of the Runtime contract
 * (repositories, worktrees, VCS state, working-tree diffs, file browsing and PTY terminals).
 *
 * Same pattern as the main runtime: Zustand stores fed by the shared OpenCode client and event stream.
 * Features import `codeRuntime` from "@/lib/runtime/code" (never @opencode/client directly).
 * With VITE_OPAL_MOCK=1 the in-memory mock (./mock/code) is used instead.
 */
import { useEffect } from "react"
import { useStore } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { createStore } from "zustand/vanilla"
import { serverStore, whenReady } from "@/lib/opencode/client"
import type { FileDiff, OpenCodeEvent } from "@/lib/opencode/types"
import { onEvent } from "./events"
import { makeMockCodeRuntime } from "./mock/code"
import { listRepos } from "./sessions-api"
import { refreshDiff } from "./stores/files"

// ---------- types ----------

export interface RepoEntry {
  /** Absolute repo root. */
  directory: string
  name: string
  /** OpenCode project id when known (needed for worktree routes). */
  projectID?: string
}

export interface WorktreeView {
  directory: string
  /** Current branch checked out in the worktree (vcs.get), when loaded. */
  branch?: string
  strategy?: string
}

export interface CodeFileEntry {
  /** Path relative to the listed directory root. */
  path: string
  type: "file" | "directory"
}

export interface PtyHandle {
  id: string
  /** Location directory the PTY was created in (also its cwd). */
  directory: string
  title: string
}

export type PtyStatus = "connecting" | "open" | "closed" | "exited"

export interface PtyHandlers {
  onData(chunk: string): void
  onStatus(status: PtyStatus, detail?: string): void
}

export interface PtyConnection {
  send(data: string): void
  /** Closes the socket (the PTY keeps running on the server). */
  close(): void
}

export interface CodeRuntime {
  /** Opened repositories (localStorage `opal.code.repos`) merged with OpenCode's git projects. */
  useRepos(): RepoEntry[]
  refreshRepos(): Promise<void>
  /** Adds a folder to the opened repositories (persisted). */
  openRepo(directory: string): Promise<RepoEntry>
  /** Removes a folder from the opened list (OpenCode's project list is unaffected). */
  forgetRepo(directory: string): void

  useWorktrees(repoDirectory: string | undefined): WorktreeView[]
  /** worktree directory → repo directory, for every repo whose worktrees were loaded. */
  useWorktreeIndex(): Record<string, string>
  refreshWorktrees(repoDirectory: string): Promise<void>
  removeWorktree(repoDirectory: string, directory: string, force: boolean): Promise<void>

  /** Current branch of a directory (vcs.get), refreshed on `vcs.branch.updated`. */
  useBranch(directory: string | undefined): string | undefined
  listBranches(directory: string): Promise<string[]>
  /** Uncommitted changes of a directory (vcs.diff mode "working", untracked files included). */
  workingDiff(directory: string): Promise<FileDiff[]>
  /** Re-fetch `session.diff` for the session (feeds runtime.useSessionDiff). */
  refreshSessionDiff(sessionID: string): Promise<void>

  listFiles(directory: string, path?: string): Promise<CodeFileEntry[]>
  readFile(directory: string, path: string): Promise<string>

  pty: {
    create(input: { directory: string; title?: string }): Promise<PtyHandle>
    /** Running PTYs whose working directory is `directory` (to re-attach after a reload). */
    list(directory: string): Promise<PtyHandle[]>
    /** Opens the PTY WebSocket (full replay, then live; reconnects resume from the last cursor). */
    connect(handle: PtyHandle, handlers: PtyHandlers): PtyConnection
    resize(handle: PtyHandle, cols: number, rows: number): Promise<void>
    close(handle: PtyHandle): Promise<void>
  }
}

// ---------- persisted repos ----------

export const REPOS_KEY = "opal.code.repos"

export function repoName(directory: string) {
  return directory.replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? directory
}

export function normalizeDir(directory: string) {
  const trimmed = directory.trim().replace(/\/+$/, "")
  return trimmed || "/"
}

export function loadOpenedRepos(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(REPOS_KEY) ?? "[]") as unknown
    return Array.isArray(raw) ? raw.filter((d): d is string => typeof d === "string") : []
  } catch {
    return []
  }
}

export function saveOpenedRepos(dirs: string[]) {
  try {
    localStorage.setItem(REPOS_KEY, JSON.stringify([...new Set(dirs)]))
  } catch {}
}

/** Opened folders first (in the user's order), then OpenCode projects not already listed. */
export function mergeRepos(opened: string[], known: { directory: string; name?: string; id?: string }[]) {
  const out = new Map<string, RepoEntry>()
  const byDir = new Map(known.map((k) => [normalizeDir(k.directory), k]))
  for (const dir of opened.map(normalizeDir)) {
    const k = byDir.get(dir)
    out.set(dir, { directory: dir, name: k?.name ?? repoName(dir), ...(k?.id ? { projectID: k.id } : {}) })
  }
  for (const k of known) {
    const dir = normalizeDir(k.directory)
    if (!out.has(dir))
      out.set(dir, { directory: dir, name: k.name ?? repoName(dir), ...(k.id ? { projectID: k.id } : {}) })
  }
  return [...out.values()]
}

// ---------- real implementation ----------

interface CodeState {
  repos: RepoEntry[]
  worktrees: Record<string, WorktreeView[]>
  branches: Record<string, string | undefined>
}

const EMPTY_WORKTREES: WorktreeView[] = []

function makeRealCodeRuntime(): CodeRuntime {
  const store = createStore<CodeState>(() => ({
    repos: mergeRepos(loadOpenedRepos(), []),
    worktrees: {},
    branches: {},
  }))
  const projectIDs = new Map<string, string>()
  const branchLoads = new Set<string>()
  const worktreeLoads = new Set<string>()
  let reposLoaded = false

  const client = () => whenReady()
  const loc = (directory: string) => ({ location: { directory } })

  async function projectIDFor(repoDirectory: string) {
    const cached =
      projectIDs.get(repoDirectory) ??
      store.getState().repos.find((r) => r.directory === repoDirectory)?.projectID
    if (cached) return cached
    const info = await (await client()).location.get(loc(repoDirectory))
    projectIDs.set(repoDirectory, info.project.id)
    return info.project.id
  }

  async function refreshRepos() {
    const known = await listRepos().catch(() => [])
    for (const k of known) projectIDs.set(normalizeDir(k.directory), k.id)
    store.setState({ repos: mergeRepos(loadOpenedRepos(), known) })
  }

  async function loadBranch(directory: string) {
    const res = await (await client()).vcs.get(loc(directory))
    store.setState((s) => ({ branches: { ...s.branches, [directory]: res.data.branch.current } }))
    return res.data.branch.current
  }

  async function refreshWorktrees(repoDirectory: string) {
    const projectID = await projectIDFor(repoDirectory)
    const list = await (await client()).worktree.list({ projectID })
    const views: WorktreeView[] = list
      .filter((w) => normalizeDir(w.directory) !== repoDirectory)
      .map((w) => ({ directory: w.directory, ...(w.strategy ? { strategy: w.strategy } : {}) }))
    store.setState((s) => ({ worktrees: { ...s.worktrees, [repoDirectory]: views } }))
    await Promise.all(views.map((v) => loadBranch(v.directory).catch(() => undefined)))
  }

  function handle(event: OpenCodeEvent) {
    if (event.type === "vcs.branch.updated" && event.location?.directory) {
      const dir = event.location.directory
      store.setState((s) => ({ branches: { ...s.branches, [dir]: event.data.branch } }))
    } else if (event.type === "worktree.updated" || event.type === "worktree.resolved") {
      for (const [dir, id] of projectIDs)
        if (id === event.data.projectID && worktreeLoads.has(dir))
          void refreshWorktrees(dir).catch(() => undefined)
    } else if (event.type === "project.updated") {
      if (reposLoaded) void refreshRepos()
    } else if (event.type === "server.connected") {
      if (reposLoaded) void refreshRepos()
      for (const dir of worktreeLoads) void refreshWorktrees(dir).catch(() => undefined)
      for (const dir of branchLoads) void loadBranch(dir).catch(() => undefined)
    }
  }
  onEvent(handle)

  const wsBase = () => {
    const status = serverStore.getState().status
    if (status.state !== "ready") throw new Error("OpenCode server is not ready")
    const url = new URL(status.url)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    return url
  }

  const decoder = new TextDecoder()

  return {
    useRepos() {
      useEffect(() => {
        if (reposLoaded) return
        reposLoaded = true
        void refreshRepos()
      }, [])
      return useStore(store, (s) => s.repos)
    },
    refreshRepos,
    async openRepo(directory) {
      const dir = normalizeDir(directory)
      saveOpenedRepos([...loadOpenedRepos(), dir])
      // Resolving the location registers the folder as an OpenCode project (and tells us its id).
      const info = await (await client()).location.get(loc(dir)).catch(() => undefined)
      if (info) projectIDs.set(dir, info.project.id)
      const entry: RepoEntry = {
        directory: dir,
        name: repoName(dir),
        ...(info ? { projectID: info.project.id } : {}),
      }
      store.setState((s) =>
        s.repos.some((r) => r.directory === dir)
          ? { repos: s.repos.map((r) => (r.directory === dir ? { ...r, ...entry, name: r.name } : r)) }
          : { repos: [entry, ...s.repos] },
      )
      return store.getState().repos.find((r) => r.directory === dir) ?? entry
    },
    forgetRepo(directory) {
      const dir = normalizeDir(directory)
      saveOpenedRepos(loadOpenedRepos().filter((d) => normalizeDir(d) !== dir))
      store.setState((s) => ({ repos: s.repos.filter((r) => r.directory !== dir) }))
    },

    useWorktrees(repoDirectory) {
      useEffect(() => {
        if (!repoDirectory || worktreeLoads.has(repoDirectory)) return
        worktreeLoads.add(repoDirectory)
        refreshWorktrees(repoDirectory).catch(() => worktreeLoads.delete(repoDirectory))
      }, [repoDirectory])
      return useStore(store, (s) =>
        repoDirectory ? (s.worktrees[repoDirectory] ?? EMPTY_WORKTREES) : EMPTY_WORKTREES,
      )
    },
    useWorktreeIndex() {
      return useStore(
        store,
        useShallow((s) => {
          const index: Record<string, string> = {}
          for (const [repo, list] of Object.entries(s.worktrees))
            for (const w of list) index[w.directory] = repo
          return index
        }),
      )
    },
    refreshWorktrees,
    async removeWorktree(repoDirectory, directory, force) {
      const projectID = await projectIDFor(repoDirectory)
      await (await client()).worktree.remove({ projectID, directory, force })
      store.setState((s) => ({
        worktrees: {
          ...s.worktrees,
          [repoDirectory]: (s.worktrees[repoDirectory] ?? []).filter((w) => w.directory !== directory),
        },
      }))
    },

    useBranch(directory) {
      useEffect(() => {
        if (!directory || branchLoads.has(directory)) return
        branchLoads.add(directory)
        loadBranch(directory).catch(() => branchLoads.delete(directory))
      }, [directory])
      return useStore(store, (s) => (directory ? s.branches[directory] : undefined))
    },
    async listBranches(directory) {
      const res = await (await client()).vcs.branch.list({ ...loc(directory), limit: 200 })
      return [...res.data]
    },
    async workingDiff(directory) {
      const res = await (await client()).vcs.diff({ ...loc(directory), mode: "working", untracked: "files" })
      return res.data
    },
    refreshSessionDiff: (sessionID) => refreshDiff(sessionID),

    async listFiles(directory, path) {
      const res = await (await client()).file.list({ ...loc(directory), ...(path ? { path } : {}) })
      // Directories come back with a trailing slash ("src/"); normalise so names and child paths work.
      return res.data.map((e) => ({ path: e.path.replace(/\/+$/, ""), type: e.type }))
    },
    async readFile(directory, path) {
      const bytes = await (await client()).file.read({ ...loc(directory), path })
      return decoder.decode(bytes)
    },

    pty: {
      async list(directory) {
        const res = await (await client()).pty.list(loc(directory))
        const want = normalizeDir(directory)
        return res.data
          .filter((p) => p.status === "running" && normalizeDir(p.cwd) === want)
          .map((p) => ({ id: p.id, directory, title: p.title }))
      },
      async create({ directory, title }) {
        const res = await (
          await client()
        ).pty.create({ ...loc(directory), cwd: directory, ...(title ? { title } : {}) })
        return { id: res.data.id, directory, title: title ?? res.data.title }
      },
      connect(handle, handlers) {
        return connectPty(handlers, {
          token: async () =>
            (
              await (
                await client()
              ).pty.connect.token({ ...loc(handle.directory), ptyID: handle.id, "x-opencode-ticket": "1" })
            ).data.ticket,
          url: (ticket, cursor) => {
            const url = wsBase()
            url.pathname = `/api/pty/${encodeURIComponent(handle.id)}/connect`
            url.searchParams.set("location[directory]", handle.directory)
            url.searchParams.set("ticket", ticket)
            if (cursor !== undefined) url.searchParams.set("cursor", String(cursor))
            return url.toString()
          },
          exited: async () => {
            const info = await (
              await client()
            ).pty
              .get({ ...loc(handle.directory), ptyID: handle.id })
              .catch(() => undefined)
            return !info || info.data.status === "exited"
          },
        })
      },
      async resize(handle, cols, rows) {
        await (
          await client()
        ).pty.update({ ...loc(handle.directory), ptyID: handle.id, size: { cols, rows } })
      },
      async close(handle) {
        await (
          await client()
        ).pty
          .remove({ ...loc(handle.directory), ptyID: handle.id })
          .catch(() => undefined)
      },
    },
  }
}

// ---------- PTY socket (shared by real runtime; exported for tests) ----------

export interface PtyTransport {
  token(): Promise<string>
  url(ticket: string, cursor?: number): string
  /** Whether the PTY has exited (decides between reconnecting and stopping). */
  exited(): Promise<boolean>
  WebSocket?: typeof WebSocket
}

/**
 * Wire protocol (core/pty/protocol.ts): outbound frames are UTF-8 terminal output (text or binary);
 * a binary frame starting with 0x00 carries `{cursor}` JSON after replay. Inbound frames are text.
 * Reconnects resume from the last cursor so output is not duplicated.
 */
export function connectPty(handlers: PtyHandlers, transport: PtyTransport): PtyConnection {
  const WS = transport.WebSocket ?? WebSocket
  const decoder = new TextDecoder()
  let socket: WebSocket | undefined
  let cursor: number | undefined
  let closed = false
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const open = async () => {
    if (closed) return
    handlers.onStatus("connecting")
    let ticket: string
    try {
      ticket = await transport.token()
    } catch (error) {
      if (await transport.exited().catch(() => false)) return handlers.onStatus("exited")
      return retry(String(error))
    }
    if (closed) return
    const ws = new WS(transport.url(ticket, cursor))
    ws.binaryType = "arraybuffer"
    socket = ws
    ws.onopen = () => {
      attempt = 0
      handlers.onStatus("open")
    }
    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data === "string") {
        if (cursor !== undefined) cursor += event.data.length
        return handlers.onData(event.data)
      }
      const bytes = new Uint8Array(event.data as ArrayBuffer)
      if (bytes[0] === 0) {
        try {
          const meta = JSON.parse(decoder.decode(bytes.subarray(1))) as { cursor?: number }
          if (typeof meta.cursor === "number") cursor = meta.cursor
        } catch {}
        return
      }
      const text = decoder.decode(bytes)
      if (cursor !== undefined) cursor += text.length
      handlers.onData(text)
    }
    ws.onclose = (event: CloseEvent) => {
      if (socket !== ws) return
      socket = undefined
      if (closed) return
      // 4404 = session exited / not found; 1000 = PTY ended normally.
      if (event.code === 4404 || event.code === 1000) return handlers.onStatus("exited", event.reason)
      void transport
        .exited()
        .catch(() => false)
        .then((gone) => (gone ? handlers.onStatus("exited") : retry(event.reason)))
    }
  }

  const retry = (detail?: string) => {
    if (closed) return
    handlers.onStatus("closed", detail)
    const delay = Math.min(250 * 2 ** attempt, 5000)
    attempt++
    timer = setTimeout(() => void open(), delay)
  }

  void open()
  return {
    send(data) {
      if (socket?.readyState === 1) socket.send(data)
    },
    close() {
      closed = true
      clearTimeout(timer)
      const ws = socket
      socket = undefined
      ws?.close()
    },
  }
}

export const codeRuntime: CodeRuntime =
  import.meta.env.VITE_OPAL_MOCK === "1" ? makeMockCodeRuntime() : makeRealCodeRuntime()
