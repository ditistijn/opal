/**
 * In-memory mock implementation of the Runtime contract.
 *
 * Used for UI development (`VITE_OPAL_MOCK=1 pnpm dev`) and unit tests. It is seeded with
 * realistic sessions/messages/projects/artifacts and simulates streaming replies when
 * `sendPrompt` is called. It never talks to a server and is not used in production builds
 * unless VITE_OPAL_MOCK is set.
 */
import { useMemo } from "react"
import { useStore } from "zustand"
import { createStore, type StoreApi } from "zustand/vanilla"
import type {
  ArtifactContent,
  FormAnswer,
  FormInfo,
  ModelRef,
  PermissionRequest,
  SessionInfo,
} from "@/lib/opencode/types"
import type {
  AppSettings,
  ArtifactKind,
  ArtifactView,
  ChatMessage,
  DroppedFile,
  MessagePart,
  ModeID,
  OpalSessionMetadata,
  PromptInput,
  Runtime,
  SessionActivity,
  ToolPart,
} from "../contracts"
import { SANDBOX_ROOT, makeSeed, makeSession, metadataJson, type MockSeed, type SessionFile } from "./seed"
import { scriptFor, type MockQuestion, type Step } from "./replies"
import { makeCodeSeed, registerMockWorktree } from "./code"

export interface MockState extends MockSeed {
  activity: Record<string, SessionActivity>
}

export interface MockRuntimeOptions {
  /** Milliseconds between streamed chunks (default 40). */
  latency?: number
  /** Start empty instead of with seed data. */
  empty?: boolean
  /** Fixed clock for deterministic seeds. */
  now?: number
  /** Persist settings (theme, sidebar) in localStorage. Default true in the browser, off in tests. */
  persist?: boolean
}

export type MockRuntime = Runtime & {
  store: StoreApi<MockState>
  /** Add a permission request (tests). */
  pushPermission(req: PermissionRequest): void
  /** Add a pending form (tests). */
  pushForm(form: FormInfo): void
  setActivity(sessionID: string, activity: SessionActivity): void
}

const EMPTY: never[] = []
const SETTINGS_KEY = "opal.mock.settings"

/** OpenCode's question tool → form mapping (packages/core/src/tool/plugin/question.ts `toField`). */
function questionFields(questions: MockQuestion[]): FormInfo["fields"] {
  const [first, ...rest] = questions.map((q, i) => ({
    key: `q${i}`,
    title: q.header,
    description: q.question,
    type: q.multiple ? ("multiselect" as const) : ("string" as const),
    options: q.options.map((o) => ({ value: o.label, label: o.label, description: o.description })),
    custom: true,
  }))
  return [first, ...rest]
}

/** The question tool's answers (`q<i>` → string[]) and model-facing output. */
function questionAnswers(questions: MockQuestion[], answer: FormAnswer) {
  const answers = questions.map((_, i) => {
    const v = answer[`q${i}`]
    return v === undefined ? [] : Array.isArray(v) ? [...v] : [String(v)]
  })
  const formatted = questions
    .map((q, i) => `"${q.question}"="${answers[i].length ? answers[i].join(", ") : "Unanswered"}"`)
    .join(", ")
  return {
    answers,
    output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
  }
}

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

function readOpal(session: SessionInfo): OpalSessionMetadata {
  const raw = session.metadata?.opal
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return {
    surface: o.surface === "code" ? "code" : "chat",
    mode: typeof o.mode === "string" ? (o.mode as ModeID) : undefined,
    projectID: typeof o.projectID === "string" ? o.projectID : undefined,
    directory: typeof o.directory === "string" ? o.directory : session.location.directory,
    repoDirectory: typeof o.repoDirectory === "string" ? o.repoDirectory : undefined,
    worktreeBranch: typeof o.worktreeBranch === "string" ? o.worktreeBranch : undefined,
    starred: o.starred === true,
  }
}

function kindOf(entry: string, files: Record<string, string>): ArtifactKind {
  const ext = entry.split(".").pop()?.toLowerCase()
  if (ext === "html" || ext === "htm") return "html"
  if (ext === "jsx" || ext === "tsx") return "react"
  if (ext === "md") return "markdown"
  if (ext === "mmd" || ext === "mermaid") return "mermaid"
  if (ext === "svg") return "svg"
  if (ext === "json") return "json"
  if (ext === "csv") return "csv"
  return files[entry] !== undefined ? "code" : "unknown"
}

function dataURL(content: string, mime = "text/html") {
  return `data:${mime};charset=utf-8,${encodeURIComponent(content)}`
}

function textOf(input: PromptInput) {
  return input.text.trim()
}

function attachmentsOf(files: DroppedFile[] | undefined, sessionID: string) {
  if (!files?.length) return undefined
  return files.map((f) => ({
    name: f.name,
    mime: f.mime,
    size: f.size ?? f.bytes?.length,
    uri: f.path ? `file://${f.path}` : `file://${SANDBOX_ROOT}/${sessionID}/uploads/${f.name}`,
  }))
}

export function makeMockRuntime(options: MockRuntimeOptions = {}): MockRuntime {
  const latency = options.latency ?? 40
  const persist = options.persist ?? (typeof window !== "undefined" && import.meta.env.MODE !== "test")
  const seed = makeSeed(options.now)
  // Code-surface seed (repos, worktree sessions, subagents, diffs) — see ./code.ts.
  const code = makeCodeSeed(options.now)
  Object.assign(seed.sessions, code.sessions)
  Object.assign(seed.messages, code.messages)
  Object.assign(seed.diffs, code.diffs)
  Object.assign(seed.permissions, code.permissions)
  if (options.empty) {
    seed.sessions = {}
    seed.messages = {}
    seed.artifacts = {}
    seed.activeArtifact = {}
    seed.files = {}
    seed.diffs = {}
    seed.permissions = {}
    seed.forms = {}
    seed.settings.projects = []
  }
  if (persist) {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<AppSettings>
      const keep: (keyof AppSettings)[] = [
        "theme",
        "sidebarCollapsed",
        "lastSurface",
        "defaultModel",
        "defaultMode",
      ]
      for (const k of keep) if (saved[k] !== undefined) Object.assign(seed.settings, { [k]: saved[k] })
    } catch {}
    const theme = new URLSearchParams(location.search).get("theme")
    if (theme === "dark" || theme === "light") seed.settings.theme = theme
  }

  const store = createStore<MockState>(() => ({
    ...seed,
    activity: options.empty ? {} : { ...code.activity },
  }))
  const get = store.getState
  const set = store.setState

  // ---------- helpers ----------
  const patchSession = (id: string, fn: (s: SessionInfo) => SessionInfo) =>
    set((st) => (st.sessions[id] ? { sessions: { ...st.sessions, [id]: fn(st.sessions[id]) } } : {}))
  const patchMeta = (id: string, patch: Partial<OpalSessionMetadata>) =>
    patchSession(id, (s) => ({ ...s, metadata: metadataJson({ ...readOpal(s), ...patch }) }))
  const setMessages = (id: string, fn: (m: ChatMessage[]) => ChatMessage[]) =>
    set((st) => ({ messages: { ...st.messages, [id]: fn(st.messages[id] ?? []) } }))
  const patchMessage = (sid: string, mid: string, fn: (m: ChatMessage) => ChatMessage) =>
    setMessages(sid, (list) => list.map((m) => (m.id === mid ? fn(m) : m)))
  const setActivity = (id: string, a: SessionActivity) =>
    set((st) => ({ activity: { ...st.activity, [id]: a } }))
  const touch = (id: string) => patchSession(id, (s) => ({ ...s, time: { ...s.time, updated: Date.now() } }))
  const saveSettings = () => {
    if (!persist) return
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(get().settings))
    } catch {}
  }

  // ---------- simulated generation ----------
  interface Job {
    sessionID: string
    messageID: string
    steps: Step[]
    timer?: ReturnType<typeof setTimeout>
    waitingPermission?: string
    waitingForm?: { formID: string; toolID: string; questions: MockQuestion[] }
    cancelled?: boolean
  }
  const jobs = new Map<string, Job>()
  const queue: { sessionID: string; text: string }[] = []

  const busyCount = () => [...jobs.values()].filter((j) => !j.cancelled).length

  const finish = (job: Job, error?: string) => {
    if (job.timer) clearTimeout(job.timer)
    job.cancelled = true
    jobs.delete(job.sessionID)
    patchMessage(job.sessionID, job.messageID, (m) => ({
      ...m,
      streaming: false,
      completed: Date.now(),
      error: error ?? m.error,
      parts: m.parts.map((p) =>
        p.type === "tool"
          ? p.status === "running" || p.status === "streaming"
            ? { ...p, status: "error", error: "Interrupted" }
            : p
          : { ...p, streaming: false },
      ),
      tokens: {
        input: 1200 + Math.round(Math.random() * 4000),
        output: 200 + Math.round(Math.random() * 900),
      },
      cost: Math.round(Math.random() * 300) / 10_000,
    }))
    setActivity(job.sessionID, "idle")
    touch(job.sessionID)
    const next = queue.shift()
    if (next) start(next.sessionID, next.text)
  }

  const updateLastPart = (job: Job, type: "text" | "reasoning", chunk: string) =>
    patchMessage(job.sessionID, job.messageID, (m) => {
      const parts = [...m.parts]
      const last = parts[parts.length - 1]
      if (last && last.type === type && last.streaming)
        parts[parts.length - 1] = { ...last, text: last.text + chunk }
      else {
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i]
          if (p.type !== "tool" && p.streaming) parts[i] = { ...p, streaming: false }
        }
        parts.push(
          type === "reasoning"
            ? { type, text: chunk, streaming: true, time: { created: Date.now() } }
            : { type, text: chunk, streaming: true },
        )
      }
      return { ...m, parts }
    })

  const closeStreamingParts = (job: Job) =>
    patchMessage(job.sessionID, job.messageID, (m) => ({
      ...m,
      parts: m.parts.map((p): MessagePart =>
        p.type === "reasoning" && p.streaming
          ? {
              ...p,
              streaming: false,
              time: { created: p.time?.created ?? Date.now(), completed: Date.now() },
            }
          : p.type === "text" && p.streaming
            ? { ...p, streaming: false }
            : p,
      ),
    }))

  /** Seeded busy sessions have no job; settle their streaming turn when stopped or answered. */
  const settleSeeded = (sessionID: string, error?: string) => {
    setMessages(sessionID, (list) =>
      list.map((m) =>
        m.streaming
          ? {
              ...m,
              streaming: false,
              completed: Date.now(),
              error,
              parts: m.parts.map((p): MessagePart =>
                p.type === "tool" && (p.status === "running" || p.status === "streaming")
                  ? error
                    ? { ...p, status: "error", error }
                    : {
                        ...p,
                        status: "completed",
                        output: "+ express-rate-limit 8.1.0",
                        time: { ...p.time, completed: Date.now() },
                      }
                  : p,
              ),
            }
          : m,
      ),
    )
    setActivity(sessionID, "idle")
    touch(sessionID)
  }

  const run = (job: Job) => {
    if (job.cancelled) return
    const step = job.steps[0]
    if (!step) return finish(job)
    const tick = (fn: () => void, ms = latency) => {
      job.timer = setTimeout(() => {
        if (!job.cancelled) fn()
      }, ms)
    }
    if (step.kind === "text" || step.kind === "reasoning") {
      const words = Math.max(1, (step.kind === "text" && step.words) || 3)
      const m = new RegExp(`^\\s*\\S+(\\s+\\S+){0,${words - 1}}\\s*`).exec(step.text)
      const chunk = m ? m[0] : step.text
      updateLastPart(job, step.kind, chunk)
      const rest = step.text.slice(chunk.length)
      if (rest) job.steps[0] = { ...step, text: rest }
      else {
        job.steps.shift()
        if (step.kind === "reasoning") closeStreamingParts(job)
      }
      return tick(() => run(job))
    }
    if (step.kind === "error") {
      job.steps.shift()
      return finish(job, step.message)
    }
    if (step.kind === "permission") {
      job.steps.shift()
      const req: PermissionRequest = {
        id: uid("perm"),
        sessionID: job.sessionID,
        action: step.action,
        resources: step.resources,
        message: step.message,
      }
      job.waitingPermission = req.id
      set((st) => ({
        permissions: { ...st.permissions, [job.sessionID]: [...(st.permissions[job.sessionID] ?? []), req] },
      }))
      return
    }
    if (step.kind === "question") {
      job.steps.shift()
      closeStreamingParts(job)
      const toolID = uid("tool")
      const formID = uid("frm")
      patchMessage(job.sessionID, job.messageID, (m) => ({
        ...m,
        parts: [
          ...m.parts,
          {
            type: "tool",
            id: toolID,
            name: "question",
            status: "running",
            input: { questions: step.questions },
            time: { created: Date.now() },
          },
        ],
      }))
      const form: FormInfo = {
        id: formID,
        sessionID: job.sessionID,
        title: "Questions",
        metadata: { kind: "question", tool: { messageID: job.messageID, id: toolID } },
        fields: questionFields(step.questions),
      }
      job.waitingForm = { formID, toolID, questions: step.questions }
      set((st) => ({ forms: { ...st.forms, [job.sessionID]: [...(st.forms[job.sessionID] ?? []), form] } }))
      return
    }
    // tool
    closeStreamingParts(job)
    const toolID = uid("tool")
    const part: ToolPart = {
      type: "tool",
      id: toolID,
      name: step.name,
      status: "running",
      input: step.input,
      time: { created: Date.now() },
    }
    patchMessage(job.sessionID, job.messageID, (m) => ({ ...m, parts: [...m.parts, part] }))
    job.steps.shift()
    tick(() => {
      let metadata: Record<string, unknown> | undefined
      if (step.artifact) {
        const id = uid("art")
        const now = Date.now()
        const content: ArtifactContent = {
          info: {
            id,
            provider: "local",
            sessionID: job.sessionID,
            title: step.artifact.title,
            entry: step.artifact.entry,
            url: "",
            time: { created: now, updated: now },
          },
          files: step.artifact.files,
        }
        const dir = readOpal(get().sessions[job.sessionID]).directory ?? `${SANDBOX_ROOT}/${job.sessionID}`
        const file: SessionFile = {
          path: `${dir}/${step.artifact.entry}`,
          name: step.artifact.entry,
          size: step.artifact.files[step.artifact.entry]?.length ?? 0,
          modified: now,
        }
        set((st) => ({
          artifacts: { ...st.artifacts, [id]: content },
          activeArtifact: { ...st.activeArtifact, [job.sessionID]: id },
          files: { ...st.files, [job.sessionID]: [...(st.files[job.sessionID] ?? []), file] },
        }))
        metadata = { artifactID: id }
      }
      patchMessage(job.sessionID, job.messageID, (m) => ({
        ...m,
        parts: m.parts.map((p) =>
          p.type === "tool" && p.id === toolID
            ? {
                ...p,
                status: "completed",
                output: step.output,
                metadata,
                time: { ...p.time, completed: Date.now() },
              }
            : p,
        ),
      }))
      run(job)
    }, latency * step.ticks)
  }

  const start = (sessionID: string, text: string) => {
    const session = get().sessions[sessionID]
    if (!session) return
    const mode = readOpal(session).mode
    const messageID = uid("msg")
    setMessages(sessionID, (list) => [
      ...list,
      {
        id: messageID,
        sessionID,
        role: "assistant",
        kind: "assistant",
        parts: [],
        model: session.model,
        agent: mode,
        created: Date.now(),
        streaming: true,
      },
    ])
    setActivity(sessionID, "busy")
    const job: Job = { sessionID, messageID, steps: scriptFor(text, mode) }
    jobs.set(sessionID, job)
    job.timer = setTimeout(() => run(job), latency * 4)
  }

  const enqueue = (sessionID: string, text: string) => {
    if (busyCount() >= get().settings.maxConcurrentConnections) {
      queue.push({ sessionID, text })
      setActivity(sessionID, "queued")
    } else start(sessionID, text)
  }

  const autoTitle = (sessionID: string, text: string) => {
    const s = get().sessions[sessionID]
    if (!s || s.title) return
    const clean = text.replace(/\s+/g, " ").trim()
    const title = clean.length > 42 ? `${clean.slice(0, 40).trim()}…` : clean || "New chat"
    setTimeout(
      () => patchSession(sessionID, (x) => ({ ...x, title: title.charAt(0).toUpperCase() + title.slice(1) })),
      latency * 6,
    )
  }

  const lastUserText = (sessionID: string) => {
    const list = get().messages[sessionID] ?? []
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]
      if (m.role === "user") return m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")
    }
    return ""
  }

  /** Answer (or dismiss) a pending form; a waiting question-tool job resumes like OpenCode's would. */
  const settleForm = (
    sessionID: string,
    formID: string,
    result: { answer?: FormAnswer; cancelled?: string },
  ) => {
    set((st) => ({
      forms: { ...st.forms, [sessionID]: (st.forms[sessionID] ?? []).filter((f) => f.id !== formID) },
    }))
    const job = jobs.get(sessionID)
    const waiting = job?.waitingForm
    if (!job || !waiting || waiting.formID !== formID) return
    job.waitingForm = undefined
    const completed = Date.now()
    const patchTool = (patch: Partial<ToolPart>) =>
      patchMessage(sessionID, job.messageID, (m) => ({
        ...m,
        parts: m.parts.map((p) =>
          p.type === "tool" && p.id === waiting.toolID
            ? { ...p, ...patch, time: { ...p.time, completed } }
            : p,
        ),
      }))
    if (result.answer) {
      const { answers, output } = questionAnswers(waiting.questions, result.answer)
      patchTool({ status: "completed", output, metadata: { answers } })
      const picked = answers.map((a) => a.join(", ")).filter(Boolean)
      job.steps.unshift({
        kind: "text",
        text: picked.length ? `Got it — ${picked.join("; ")}. ` : "Got it. ",
      })
      return run(job)
    }
    // Upstream: a dismissal with a message is model-facing feedback and the turn continues;
    // without one the step ends.
    if (!result.cancelled) {
      patchTool({ status: "error", error: "The user dismissed this question" })
      return finish(job)
    }
    patchTool({ status: "error", error: result.cancelled })
    job.steps = [{ kind: "text", text: "No problem — I'll go with sensible defaults." }]
    run(job)
  }

  // ---------- hooks ----------
  const useS = <T>(sel: (s: MockState) => T) => useStore(store, sel)

  const runtime: MockRuntime = {
    store,
    pushForm(form) {
      set((st) => ({ forms: { ...st.forms, [form.sessionID]: [...(st.forms[form.sessionID] ?? []), form] } }))
    },
    pushPermission(req) {
      set((st) => ({
        permissions: { ...st.permissions, [req.sessionID]: [...(st.permissions[req.sessionID] ?? []), req] },
      }))
    },
    setActivity,

    useServer: () => ({ state: "ready", url: "mock://opal", version: "mock" }),
    restartServer: async () => {},

    useSessions(filter) {
      const sessions = useS((s) => s.sessions)
      const messages = useS((s) => s.messages)
      const { surface, projectID, search, archived } = filter
      return useMemo(() => {
        const q = search?.trim().toLowerCase()
        return Object.values(sessions)
          .filter((s) => {
            const meta = readOpal(s)
            if (s.parentID) return false
            if (meta.surface !== surface) return false
            if (projectID !== undefined && meta.projectID !== projectID) return false
            if (!!s.time.archived !== !!archived) return false
            if (q) {
              const inTitle = (s.title ?? "").toLowerCase().includes(q)
              const inBody = (messages[s.id] ?? []).some((m) =>
                m.parts.some((p) => p.type === "text" && p.text.toLowerCase().includes(q)),
              )
              if (!inTitle && !inBody) return false
            }
            return true
          })
          .sort((a, b) => b.time.updated - a.time.updated)
      }, [sessions, messages, surface, projectID, search, archived])
    },
    useSession: (id) => useS((s) => (id ? s.sessions[id] : undefined)),
    useChildSessions(parentID) {
      const sessions = useS((s) => s.sessions)
      return useMemo(
        () => (parentID ? Object.values(sessions).filter((s) => s.parentID === parentID) : EMPTY),
        [sessions, parentID],
      )
    },
    async createSession(input) {
      const id = uid("ses")
      const now = Date.now()
      const project = input.projectID
        ? get().settings.projects.find((p) => p.id === input.projectID)
        : undefined
      const session = makeSession({
        id,
        title: input.title,
        surface: input.surface,
        mode:
          input.mode ??
          project?.defaultMode ??
          (input.surface === "code" ? "code" : get().settings.defaultMode),
        projectID: input.projectID,
        model: input.model ?? project?.defaultModel ?? get().settings.defaultModel,
        created: now,
        directory: input.directory,
        repoDirectory: input.repoDirectory,
        worktreeBranch: input.worktreeBranch,
      })
      set((st) => ({ sessions: { ...st.sessions, [id]: session }, messages: { ...st.messages, [id]: [] } }))
      return session
    },
    async renameSession(id, title) {
      patchSession(id, (s) => ({ ...s, title }))
    },
    async deleteSession(id) {
      const job = jobs.get(id)
      if (job) finish(job)
      set((st) => {
        const sessions = { ...st.sessions }
        delete sessions[id]
        return { sessions }
      })
    },
    async archiveSession(id, archived) {
      patchSession(id, (s) => ({ ...s, time: { ...s.time, archived: archived ? Date.now() : undefined } }))
    },
    async starSession(id, starred) {
      patchMeta(id, { starred })
    },
    async setSessionModel(id, model: ModelRef) {
      patchSession(id, (s) => ({ ...s, model }))
    },
    async setSessionMode(id, mode) {
      patchSession(id, (s) => ({ ...s, agent: mode }))
      patchMeta(id, { mode })
    },
    getOpalMetadata: readOpal,

    useMessages: (id) => useS((s) => (id ? (s.messages[id] ?? EMPTY) : EMPTY)),
    useSessionActivity: (id) => useS((s) => (id ? (s.activity[id] ?? "idle") : "idle")),
    async sendPrompt(sessionID, input) {
      const text = textOf(input)
      setMessages(sessionID, (list) => [
        ...list,
        {
          id: uid("msg"),
          sessionID,
          role: "user",
          kind: "user",
          parts: [{ type: "text", text: input.text }],
          attachments: attachmentsOf(input.files, sessionID),
          created: Date.now(),
        },
      ])
      if (input.files?.length) {
        const dir = readOpal(get().sessions[sessionID]).directory ?? `${SANDBOX_ROOT}/${sessionID}`
        const added: SessionFile[] = input.files.map((f) => ({
          path: f.path ?? `${dir}/uploads/${f.name}`,
          name: f.name,
          size: f.size ?? f.bytes?.length ?? 0,
          modified: Date.now(),
        }))
        set((st) => ({ files: { ...st.files, [sessionID]: [...(st.files[sessionID] ?? []), ...added] } }))
      }
      touch(sessionID)
      autoTitle(sessionID, text)
      enqueue(sessionID, text)
    },
    async editMessage(sessionID, messageID, input) {
      const job = jobs.get(sessionID)
      if (job) finish(job)
      setMessages(sessionID, (list) => {
        const i = list.findIndex((m) => m.id === messageID)
        return i < 0 ? list : list.slice(0, i)
      })
      await runtime.sendPrompt(sessionID, input)
    },
    async regenerate(sessionID) {
      const job = jobs.get(sessionID)
      if (job) finish(job)
      const text = lastUserText(sessionID)
      setMessages(sessionID, (list) => {
        const last = list[list.length - 1]
        return last?.role === "assistant" ? list.slice(0, -1) : list
      })
      enqueue(sessionID, text)
    },
    async interrupt(sessionID) {
      const qi = queue.findIndex((q) => q.sessionID === sessionID)
      if (qi >= 0) {
        queue.splice(qi, 1)
        setActivity(sessionID, "idle")
      }
      const job = jobs.get(sessionID)
      if (job) finish(job)
      else if (get().activity[sessionID] === "busy") settleSeeded(sessionID, "Interrupted")
      set((st) => ({
        permissions: { ...st.permissions, [sessionID]: EMPTY },
        forms: { ...st.forms, [sessionID]: EMPTY },
      }))
    },

    usePermissions: (id) => useS((s) => (id ? (s.permissions[id] ?? EMPTY) : EMPTY)),
    async replyPermission(sessionID, requestID, decision) {
      set((st) => ({
        permissions: {
          ...st.permissions,
          [sessionID]: (st.permissions[sessionID] ?? []).filter((p) => p.id !== requestID),
        },
      }))
      const job = jobs.get(sessionID)
      if (!job && get().activity[sessionID] === "busy" && !(get().permissions[sessionID] ?? []).length)
        settleSeeded(sessionID, decision === "reject" ? "Permission denied" : undefined)
      if (!job || job.waitingPermission !== requestID) return
      job.waitingPermission = undefined
      if (decision === "reject") job.steps = [{ kind: "text", text: "Okay — I won't make that change." }]
      run(job)
    },

    useForms: (id) => useS((s) => (id ? (s.forms[id] ?? EMPTY) : EMPTY)),
    async replyForm(sessionID, formID, answer) {
      settleForm(sessionID, formID, { answer })
    },
    async cancelForm(sessionID, formID, message) {
      settleForm(sessionID, formID, { cancelled: message ?? "" })
    },

    useModels: () => useS((s) => s.models),
    useProviders: () => useS((s) => s.providers),
    useAgents: () => useS((s) => s.agents),
    refreshCatalog: async () => {},

    useArtifacts(sessionID) {
      const artifacts = useS((s) => s.artifacts)
      return useMemo(
        () =>
          sessionID
            ? Object.values(artifacts)
                .filter((a) => a.info.sessionID === sessionID)
                .map((a) => a.info)
                .sort((a, b) => a.time.created - b.time.created)
            : EMPTY,
        [artifacts, sessionID],
      )
    },
    useArtifact(artifactID) {
      const a = useS((s) => (artifactID ? s.artifacts[artifactID] : undefined))
      return useMemo((): ArtifactView | undefined => {
        if (!a) return undefined
        const kind = kindOf(a.info.entry, a.files)
        const body = a.files[a.info.entry] ?? ""
        return {
          info: a.info,
          kind,
          previewURL: dataURL(body, kind === "svg" ? "image/svg+xml" : "text/html"),
          versions: [
            {
              n: 1,
              time: a.info.time.updated,
              path: `/mock/artifact-versions/${a.info.id}/1`,
              title: a.info.title,
            },
          ],
        }
      }, [a])
    },
    async getArtifactContent(id) {
      const a = get().artifacts[id]
      if (!a) throw new Error(`artifact ${id} not found`)
      return a
    },
    async updateArtifact(id, files, title) {
      set((st) => {
        const a = st.artifacts[id]
        if (!a) return {}
        return {
          artifacts: {
            ...st.artifacts,
            [id]: {
              info: {
                ...a.info,
                title: title ?? a.info.title,
                time: { ...a.info.time, updated: Date.now() },
              },
              files,
            },
          },
        }
      })
    },
    restoreArtifactVersion: async () => {},
    useActiveArtifact(sessionID) {
      const artifactID = useS((s) => (sessionID ? s.activeArtifact[sessionID] : undefined))
      return {
        artifactID,
        setActive: (id?: string) => {
          if (!sessionID) return
          set((st) => ({ activeArtifact: { ...st.activeArtifact, [sessionID]: id } }))
        },
      }
    },

    useSessionFiles: (id) => useS((s) => (id ? (s.files[id] ?? EMPTY) : EMPTY)),
    revealPath: async () => {},
    openPath: async () => {},
    saveFileAs: async () => {},

    useSessionDiff: (id) => useS((s) => (id ? (s.diffs[id] ?? EMPTY) : EMPTY)),
    listRepos: async () => [
      { id: "repo_acme", directory: "/Users/demo/Developer/acme-api", name: "acme-api" },
      { id: "repo_site", directory: "/Users/demo/Developer/marketing-site", name: "marketing-site" },
    ],
    pickDirectory: async () => "/Users/demo/Developer/new-project",
    createWorktree: async (repo, base, branch) => registerMockWorktree(repo, base, branch),

    useSettings: () => useS((s) => s.settings),
    async updateSettings(patch) {
      set((st) => ({ settings: { ...st.settings, ...patch } }))
      saveSettings()
    },
    async saveProvider(provider) {
      const clean = { ...provider, apiKey: undefined }
      set((st) => {
        const list = st.settings.providers.filter((p) => p.id !== provider.id)
        return { settings: { ...st.settings, providers: [...list, clean] } }
      })
    },
    async deleteProvider(id) {
      set((st) => ({
        settings: { ...st.settings, providers: st.settings.providers.filter((p) => p.id !== id) },
      }))
    },
    testProvider: async () => ({ ok: true, message: "Connected (mock)", latencyMs: 182 }),
    importOpenCodeConfig: async () => ({ imported: 0 }),
    async saveProject(project) {
      set((st) => {
        const exists = st.settings.projects.some((p) => p.id === project.id)
        const projects = exists
          ? st.settings.projects.map((p) => (p.id === project.id ? { ...project, updated: Date.now() } : p))
          : [...st.settings.projects, project]
        return { settings: { ...st.settings, projects } }
      })
    },
    async deleteProject(id) {
      set((st) => ({
        settings: { ...st.settings, projects: st.settings.projects.filter((p) => p.id !== id) },
      }))
    },
    async addProjectKnowledge(projectID, files) {
      const now = Date.now()
      set((st) => ({
        settings: {
          ...st.settings,
          projects: st.settings.projects.map((p) =>
            p.id === projectID
              ? {
                  ...p,
                  updated: now,
                  knowledge: [
                    ...p.knowledge,
                    ...files.map((f) => ({
                      name: f.name,
                      path: f.path ?? `/mock/projects/${projectID}/knowledge/${f.name}`,
                      size: f.size ?? f.bytes?.length ?? 0,
                      added: now,
                    })),
                  ],
                }
              : p,
          ),
        },
      }))
    },
    getPrompt: async (mode) => ({
      builtin: `# ${mode} mode\n\nBuilt-in system prompt (mock).`,
      override: get().settings.promptOverrides[mode],
    }),
    async setPromptOverride(mode, text) {
      set((st) => ({
        settings: { ...st.settings, promptOverrides: { ...st.settings.promptOverrides, [mode]: text } },
      }))
    },
  }
  return runtime
}
