/**
 * Mock data + in-memory CodeRuntime for the Code surface (VITE_OPAL_MOCK=1 and unit tests).
 * Never used when the real runtime is active. The fake terminal is a tiny line-echo shell that
 * only knows a few commands — it exists so the terminal pane can be developed without a server.
 */
import { useStore } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { createStore } from "zustand/vanilla"
import type { FileDiff, PermissionRequest, SessionInfo } from "@/lib/opencode/types"
import type { CodeFileEntry, CodeRuntime, PtyHandle, RepoEntry, WorktreeView } from "../code"
import type { ChatMessage, SessionActivity, ToolPart } from "../contracts"
import { DAY, DEFAULT_MODEL, HOUR, makeSession } from "./seed"

export const MOCK_REPOS: RepoEntry[] = [
  { directory: "/Users/demo/Developer/acme-api", name: "acme-api", projectID: "prj_acme" },
  { directory: "/Users/demo/Developer/marketing-site", name: "marketing-site", projectID: "prj_site" },
]
export const WORKTREE_ROOT = "/Users/demo/Library/Application Support/Opal/opencode/data/opencode/worktree"
const ACME = MOCK_REPOS[0].directory
const SITE = MOCK_REPOS[1].directory
const WT_RATE = `${WORKTREE_ROOT}/prj_ac/rate-limit`
const WT_VITEST = `${WORKTREE_ROOT}/prj_ac/vitest-4`

// ---------- shared mutable state (worktrees created through the mock runtime land here) ----------

interface MockCodeState {
  repos: RepoEntry[]
  worktrees: Record<string, WorktreeView[]>
  branches: Record<string, string | undefined>
}

function initialState(): MockCodeState {
  return {
    repos: [...MOCK_REPOS],
    worktrees: {
      [ACME]: [
        { directory: WT_RATE, branch: "opal/rate-limit", strategy: "git" },
        { directory: WT_VITEST, branch: "opal/vitest-4", strategy: "git" },
      ],
      [SITE]: [],
    },
    branches: { [ACME]: "main", [SITE]: "main", [WT_RATE]: "opal/rate-limit", [WT_VITEST]: "opal/vitest-4" },
  }
}

export const mockCodeStore = createStore<MockCodeState>(initialState)

export function resetMockCode() {
  mockCodeStore.setState(initialState(), true)
}

/** Called by the mock Runtime's createWorktree. */
export function registerMockWorktree(repoDirectory: string, base: string | undefined, branch?: string) {
  const slug = (branch ?? `opal/${Math.random().toString(36).slice(2, 7)}`).replace(/^.*\//, "")
  const name = branch ?? `opal/${slug}`
  const directory = `${WORKTREE_ROOT}/${repoDirectory.split("/").pop()?.slice(0, 6) ?? "repo"}/${slug}`
  mockCodeStore.setState((s) => ({
    worktrees: {
      ...s.worktrees,
      [repoDirectory]: [...(s.worktrees[repoDirectory] ?? []), { directory, branch: name, strategy: "git" }],
    },
    branches: { ...s.branches, [directory]: name },
  }))
  void base
  return { directory, branch: name }
}

// ---------- files ----------

const AUTH_TS_AFTER = `import type { NextFunction, Request, Response } from "express"
import { verifyToken } from "../lib/jwt"

/** Rejects requests without a valid bearer token. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? ""
  const token = header.replace(/^Bearer\\s+/i, "").trim()
  if (!token) return res.status(401).json({ error: "missing_token" })
  try {
    req.user = await verifyToken(token)
    return next()
  } catch {
    return res.status(401).json({ error: "invalid_token" })
  }
}
`

const MOCK_FILES: Record<string, string> = {
  "package.json": `{
  "name": "acme-api",
  "private": true,
  "type": "module",
  "scripts": { "dev": "tsx watch src/index.ts", "test": "vitest run" },
  "dependencies": { "express": "^5.1.0", "jose": "^6.0.0" },
  "devDependencies": { "vitest": "^4.1.0", "tsx": "^4.21.0" }
}
`,
  "README.md": "# acme-api\n\nHTTP API for the Acme dashboard.\n\n```sh\npnpm dev\npnpm test\n```\n",
  "tsconfig.json": `{ "compilerOptions": { "target": "es2023", "module": "nodenext", "strict": true } }\n`,
  "src/index.ts": `import express from "express"
import { requireAuth } from "./middleware/auth"
import { login } from "./routes/login"

const app = express()
app.use(express.json())
app.post("/login", login)
app.get("/me", requireAuth, (req, res) => res.json(req.user))
app.listen(3000)
`,
  "src/middleware/auth.ts": AUTH_TS_AFTER,
  "src/routes/login.ts": `import type { Request, Response } from "express"
import { signToken } from "../lib/jwt"

export async function login(req: Request, res: Response) {
  const { email, password } = req.body ?? {}
  if (!email || !password) return res.status(400).json({ error: "missing_credentials" })
  return res.json({ token: await signToken({ email }) })
}
`,
  "src/lib/jwt.ts": `import { SignJWT, jwtVerify } from "jose"

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? "dev-secret")

export const signToken = (claims: Record<string, unknown>) =>
  new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(secret)

export async function verifyToken(token: string) {
  return (await jwtVerify(token, secret)).payload
}
`,
  "tests/auth.test.ts": `import { describe, expect, it } from "vitest"
import { requireAuth } from "../src/middleware/auth"

describe("requireAuth", () => {
  it("rejects a missing token", async () => {
    const res = fakeResponse()
    await requireAuth({ headers: {} } as never, res as never, () => {})
    expect(res.statusCode).toBe(401)
  })
})
`,
}

function listMockFiles(path?: string): CodeFileEntry[] {
  const prefix = path ? `${path.replace(/\/+$/, "")}/` : ""
  const out = new Map<string, CodeFileEntry>()
  for (const file of Object.keys(MOCK_FILES)) {
    if (!file.startsWith(prefix)) continue
    const rest = file.slice(prefix.length)
    const [head, ...tail] = rest.split("/")
    const full = prefix + head
    out.set(full, { path: full, type: tail.length ? "directory" : "file" })
  }
  return [...out.values()].sort((a, b) =>
    a.type === b.type ? a.path.localeCompare(b.path) : a.type === "directory" ? -1 : 1,
  )
}

// ---------- diffs ----------

export const AUTH_DIFF: FileDiff = {
  file: "src/middleware/auth.ts",
  status: "modified",
  additions: 9,
  deletions: 3,
  patch: `Index: src/middleware/auth.ts
===================================================================
--- src/middleware/auth.ts
+++ src/middleware/auth.ts
@@ -2,8 +2,14 @@
 import { verifyToken } from "../lib/jwt"

 /** Rejects requests without a valid bearer token. */
 export async function requireAuth(req: Request, res: Response, next: NextFunction) {
-  const token = req.headers.authorization?.split(" ")[1]
-  if (!token) return res.status(401).send()
-  verifyToken(token).then((user) => { req.user = user; next() })
+  const header = req.headers.authorization ?? ""
+  const token = header.replace(/^Bearer\\s+/i, "").trim()
+  if (!token) return res.status(401).json({ error: "missing_token" })
+  try {
+    req.user = await verifyToken(token)
+    return next()
+  } catch {
+    return res.status(401).json({ error: "invalid_token" })
+  }
 }
`,
}

export const AUTH_TEST_DIFF: FileDiff = {
  file: "tests/auth.test.ts",
  status: "modified",
  additions: 13,
  deletions: 0,
  patch: `Index: tests/auth.test.ts
===================================================================
--- tests/auth.test.ts
+++ tests/auth.test.ts
@@ -8,3 +8,16 @@
     expect(res.statusCode).toBe(401)
   })
+
+  it("waits for token verification before calling next()", async () => {
+    const res = fakeResponse()
+    let called = false
+    await requireAuth(
+      { headers: { authorization: \`Bearer \${await signToken({ id: 1 })}\` } } as never,
+      res as never,
+      () => {
+        called = true
+      },
+    )
+    expect(called).toBe(true)
+  })
 })
`,
}

const JWT_DIFF: FileDiff = {
  file: "src/lib/clock.ts",
  status: "added",
  additions: 4,
  deletions: 0,
  patch: `Index: src/lib/clock.ts
===================================================================
--- src/lib/clock.ts
+++ src/lib/clock.ts
@@ -0,0 +1,4 @@
+/** Injectable clock so token expiry can be tested deterministically. */
+export interface Clock {
+  now(): number
+}
`,
}

const RATE_DIFF: FileDiff = {
  file: "src/middleware/rate-limit.ts",
  status: "added",
  additions: 9,
  deletions: 0,
  patch: `Index: src/middleware/rate-limit.ts
===================================================================
--- src/middleware/rate-limit.ts
+++ src/middleware/rate-limit.ts
@@ -0,0 +1,9 @@
+import rateLimit from "express-rate-limit"
+
+/** 5 attempts per minute per IP on credential endpoints. */
+export const loginLimiter = rateLimit({
+  windowMs: 60_000,
+  limit: 5,
+  standardHeaders: "draft-8",
+  legacyHeaders: false,
+})
`,
}

const README_DIFF: FileDiff = {
  file: "README.md",
  status: "modified",
  additions: 2,
  deletions: 1,
  patch: `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1,3 +1,4 @@
 # acme-api

-HTTP API for the Acme dashboard.
+HTTP API for the Acme dashboard and mobile apps.
+Requires Node 22+.
`,
}

// ---------- sessions + transcripts ----------

function tool(
  id: string,
  name: string,
  input: Record<string, unknown>,
  output: string,
  created: number,
  extra: Partial<ToolPart> = {},
): ToolPart {
  return {
    type: "tool",
    id,
    name,
    status: "completed",
    input,
    output,
    time: { created, completed: created + 1200 },
    ...extra,
  }
}

export interface CodeSeed {
  sessions: Record<string, SessionInfo>
  messages: Record<string, ChatMessage[]>
  diffs: Record<string, FileDiff[]>
  permissions: Record<string, PermissionRequest[]>
  activity: Record<string, SessionActivity>
}

export function makeCodeSeed(now = Date.now()): CodeSeed {
  const sessions: Record<string, SessionInfo> = {}
  const messages: Record<string, ChatMessage[]> = {}
  const add = (s: SessionInfo, m: ChatMessage[] = []) => {
    sessions[s.id] = s
    messages[s.id] = m
  }

  // 1. Repo session (no worktree), finished.
  const t1 = now - 2 * HOUR
  add(
    makeSession({
      id: "ses_code_auth",
      title: "Fix flaky auth middleware test",
      surface: "code",
      mode: "code",
      model: DEFAULT_MODEL,
      created: t1,
      updated: t1 + 6 * 60_000,
      directory: ACME,
    }),
    [
      {
        id: "msg_ca_1",
        sessionID: "ses_code_auth",
        role: "user",
        kind: "user",
        parts: [
          {
            type: "text",
            text: "The auth middleware test fails about 1 in 5 runs on CI. Find out why and fix it.",
          },
        ],
        created: t1,
      },
      {
        id: "msg_ca_2",
        sessionID: "ses_code_auth",
        role: "assistant",
        kind: "assistant",
        model: DEFAULT_MODEL,
        agent: "code",
        created: t1 + 2000,
        completed: t1 + 9500,
        tokens: { input: 1_912, output: 513 },
        cost: 0.0135,
        parts: [
          {
            type: "reasoning",
            text: "A 1-in-5 failure smells like a race. The middleware probably calls next() before token verification resolves.",
            time: { created: t1 + 2000, completed: t1 + 6000 },
          },
          tool(
            "t_ca_1",
            "read",
            { path: "src/middleware/auth.ts" },
            MOCK_FILES["src/middleware/auth.ts"],
            t1 + 7000,
          ),
          tool(
            "t_ca_2",
            "grep",
            { pattern: "requireAuth" },
            "src/index.ts:7\ntests/auth.test.ts:2",
            t1 + 9000,
          ),
        ],
      },
      // Real OpenCode emits one assistant message per step (tool round); the turn reads as one response.
      {
        id: "msg_ca_3",
        sessionID: "ses_code_auth",
        role: "assistant",
        kind: "assistant",
        model: DEFAULT_MODEL,
        agent: "code",
        created: t1 + 10_000,
        completed: t1 + 41_000,
        tokens: { input: 5_102, output: 402 },
        cost: 0.0213,
        parts: [
          {
            type: "text",
            text: "Found it — `verifyToken(...)` is never awaited, so the handler returns before `next()` runs and the test sometimes asserts too early. I'll make the middleware `async`, await verification, and return JSON errors.",
          },
          tool(
            "t_ca_3",
            "edit",
            { path: "src/middleware/auth.ts" },
            "Edited src/middleware/auth.ts (1 replacement)",
            t1 + 20_000,
            {
              metadata: { files: [AUTH_DIFF] },
            },
          ),
          tool(
            "t_ca_4",
            "edit",
            { path: "tests/auth.test.ts" },
            "Edited tests/auth.test.ts (1 replacement)",
            t1 + 40_000,
            {
              metadata: { files: [AUTH_TEST_DIFF] },
            },
          ),
        ],
      },
      // Real OpenCode emits one assistant message per step (tool round); the turn reads as one response.
      {
        id: "msg_ca_4",
        sessionID: "ses_code_auth",
        role: "assistant",
        kind: "assistant",
        model: DEFAULT_MODEL,
        agent: "code",
        created: t1 + 42_000,
        completed: t1 + 61_000,
        tokens: { input: 5_480, output: 96 },
        cost: 0.0189,
        parts: [
          tool(
            "t_ca_5",
            "shell",
            {
              command: "pnpm vitest run tests/auth.test.ts --repeat 50",
              description: "Run auth tests 50 times",
            },
            " RUN  v4.1.0 /Users/demo/Developer/acme-api\n\n ✓ tests/auth.test.ts (100 tests) 412ms\n\n Test Files  1 passed (1)\n      Tests  100 passed (100)\n   Duration  1.21s",
            t1 + 60_000,
            { metadata: { exit: 0 } },
          ),
        ],
      },
      // Real OpenCode emits one assistant message per step (tool round); the turn reads as one response.
      {
        id: "msg_ca_5",
        sessionID: "ses_code_auth",
        role: "assistant",
        kind: "assistant",
        model: DEFAULT_MODEL,
        agent: "code",
        created: t1 + 62_000,
        completed: t1 + 6 * 60_000,
        tokens: { input: 5_710, output: 301 },
        cost: 0.0204,
        changedFiles: ["src/middleware/auth.ts", "tests/auth.test.ts"],
        parts: [
          {
            type: "text",
            text: "Fixed. The race is gone — the suite now passes **50/50 repeated runs**.\n\n- `src/middleware/auth.ts`: awaits `verifyToken` and handles failures with a 401 JSON body.\n- `tests/auth.test.ts`: adds a regression test that `next()` runs only after verification.",
          },
        ],
      },
    ],
  )

  // 2. Worktree session waiting on a permission.
  const t2 = now - 4 * 60_000
  add(
    makeSession({
      id: "ses_code_rate",
      title: "Add rate limiting to /login",
      surface: "code",
      mode: "code",
      model: DEFAULT_MODEL,
      created: t2,
      updated: now - 30_000,
      directory: WT_RATE,
      repoDirectory: ACME,
      worktreeBranch: "opal/rate-limit",
    }),
    [
      {
        id: "msg_cr_1",
        sessionID: "ses_code_rate",
        role: "user",
        kind: "user",
        parts: [{ type: "text", text: "Add rate limiting to POST /login — 5 attempts per minute per IP." }],
        created: t2,
      },
      {
        id: "msg_cr_2",
        sessionID: "ses_code_rate",
        role: "assistant",
        kind: "assistant",
        model: DEFAULT_MODEL,
        agent: "code",
        created: t2 + 1500,
        streaming: true,
        parts: [
          tool(
            "t_cr_1",
            "read",
            { path: "src/routes/login.ts" },
            MOCK_FILES["src/routes/login.ts"],
            t2 + 3000,
          ),
          tool(
            "t_cr_2",
            "write",
            { path: "src/middleware/rate-limit.ts" },
            "Wrote src/middleware/rate-limit.ts",
            t2 + 9000,
            {
              metadata: { files: [RATE_DIFF] },
            },
          ),
          {
            type: "text",
            text: "I'll use `express-rate-limit` rather than hand-rolling a counter. Installing it first.",
          },
          {
            type: "tool",
            id: "t_cr_3",
            name: "shell",
            status: "running",
            input: { command: "pnpm add express-rate-limit", description: "Install express-rate-limit" },
            time: { created: now - 40_000 },
          },
        ],
      },
    ],
  )

  // 3. Worktree session that used subagents.
  const t3 = now - DAY - 3 * HOUR
  add(
    makeSession({
      id: "ses_code_vitest",
      title: "Migrate test suite to Vitest 4",
      surface: "code",
      mode: "code",
      model: DEFAULT_MODEL,
      created: t3,
      updated: t3 + 25 * 60_000,
      directory: WT_VITEST,
      repoDirectory: ACME,
      worktreeBranch: "opal/vitest-4",
    }),
    [
      {
        id: "msg_cv_1",
        sessionID: "ses_code_vitest",
        role: "user",
        kind: "user",
        parts: [
          { type: "text", text: "Migrate the remaining Jest tests to Vitest 4. Parallelize where you can." },
        ],
        created: t3,
      },
      {
        id: "msg_cv_2",
        sessionID: "ses_code_vitest",
        role: "assistant",
        kind: "assistant",
        model: DEFAULT_MODEL,
        agent: "code",
        created: t3 + 2000,
        completed: t3 + 25 * 60_000,
        tokens: { input: 64_211, output: 4_870 },
        cost: 0.2654,
        parts: [
          { type: "text", text: "Splitting this into two independent pieces of work." },
          tool(
            "t_cv_1",
            "subagent",
            { description: "Audit jest config usage", prompt: "List every Jest-specific API in the repo." },
            '<subagent sessionID="ses_code_vitest_a" state="completed">\n14 usages across 6 files.\n</subagent>',
            t3 + 4000,
            { metadata: { sessionID: "ses_code_vitest_a", status: "completed" } },
          ),
          tool(
            "t_cv_2",
            "subagent",
            { description: "Port snapshot tests", prompt: "Port tests/__snapshots__ to Vitest." },
            '<subagent sessionID="ses_code_vitest_b" state="completed">\nPorted 9 snapshot files.\n</subagent>',
            t3 + 4500,
            { metadata: { sessionID: "ses_code_vitest_b", status: "completed" } },
          ),
          tool("t_cv_3", "write", { path: "src/lib/clock.ts" }, "Wrote src/lib/clock.ts", t3 + 20 * 60_000, {
            metadata: { files: [JWT_DIFF] },
          }),
          {
            type: "text",
            text: "All 31 test files now run on Vitest 4. Jest and `ts-jest` are removed from `devDependencies`.",
          },
        ],
      },
    ],
  )
  const child = (id: string, title: string, offset: number, summary: string) =>
    add(
      makeSession({
        id,
        title,
        surface: "code",
        mode: "general",
        model: { providerID: "anthropic", id: "claude-haiku-4-5" },
        created: t3 + offset,
        updated: t3 + offset + 8 * 60_000,
        directory: WT_VITEST,
        parentID: "ses_code_vitest",
      }),
      [
        {
          id: `${id}_u`,
          sessionID: id,
          role: "user",
          kind: "user",
          parts: [{ type: "text", text: title }],
          created: t3 + offset,
        },
        {
          id: `${id}_a`,
          sessionID: id,
          role: "assistant",
          kind: "assistant",
          created: t3 + offset + 1000,
          completed: t3 + offset + 8 * 60_000,
          parts: [
            tool(
              `${id}_t`,
              "grep",
              { pattern: "jest\\." },
              "tests/a.test.ts:3\ntests/b.test.ts:9",
              t3 + offset + 2000,
            ),
            { type: "text", text: summary },
          ],
        },
      ],
    )
  child(
    "ses_code_vitest_a",
    "Audit jest config usage",
    4000,
    "Found **14** Jest-specific calls across 6 files.",
  )
  child("ses_code_vitest_b", "Port snapshot tests", 4500, "Ported 9 snapshot files; all pass under Vitest.")

  // 4. Another repo.
  const t4 = now - 3 * DAY
  add(
    makeSession({
      id: "ses_site_hero",
      title: "Tighten hero section copy and spacing",
      surface: "code",
      mode: "code",
      model: DEFAULT_MODEL,
      created: t4,
      directory: SITE,
    }),
    [
      {
        id: "msg_sh_1",
        sessionID: "ses_site_hero",
        role: "user",
        kind: "user",
        parts: [{ type: "text", text: "The hero feels cramped on mobile. Tighten the copy and spacing." }],
        created: t4,
      },
      {
        id: "msg_sh_2",
        sessionID: "ses_site_hero",
        role: "assistant",
        kind: "assistant",
        created: t4 + 2000,
        completed: t4 + 90_000,
        parts: [
          {
            type: "text",
            text: "Shortened the headline to 6 words and reduced vertical padding below 640px.",
          },
        ],
      },
    ],
  )

  return {
    sessions,
    messages,
    diffs: {
      ses_code_auth: [AUTH_DIFF, AUTH_TEST_DIFF],
      ses_code_rate: [RATE_DIFF],
      ses_code_vitest: [JWT_DIFF],
    },
    permissions: {
      ses_code_rate: [
        {
          id: "perm_code_rate",
          sessionID: "ses_code_rate",
          action: "bash",
          resources: ["pnpm add express-rate-limit"],
          message: "Run pnpm add express-rate-limit",
        },
      ],
    },
    activity: { ses_code_rate: "busy" },
  }
}

// ---------- mock CodeRuntime ----------

const EMPTY_WT: WorktreeView[] = []

export function makeMockCodeRuntime(): CodeRuntime {
  const useS = <T>(sel: (s: MockCodeState) => T) => useStore(mockCodeStore, sel)
  const shells = new Map<string, { cwd: string; title: string }>()

  return {
    useRepos: () => useS((s) => s.repos),
    refreshRepos: async () => {},
    async openRepo(directory) {
      const dir = directory.replace(/\/+$/, "")
      const entry: RepoEntry = { directory: dir, name: dir.split("/").pop() ?? dir }
      mockCodeStore.setState((s) =>
        s.repos.some((r) => r.directory === dir)
          ? s
          : { repos: [entry, ...s.repos], branches: { ...s.branches, [dir]: "main" } },
      )
      return entry
    },
    forgetRepo(directory) {
      mockCodeStore.setState((s) => ({ repos: s.repos.filter((r) => r.directory !== directory) }))
    },
    useWorktrees: (repo) => useS((s) => (repo ? (s.worktrees[repo] ?? EMPTY_WT) : EMPTY_WT)),
    useWorktreeIndex: () =>
      useS(
        useShallow((s) => {
          const index: Record<string, string> = {}
          for (const [repo, list] of Object.entries(s.worktrees))
            for (const w of list) index[w.directory] = repo
          return index
        }),
      ),
    refreshWorktrees: async () => {},
    async removeWorktree(repo, directory) {
      mockCodeStore.setState((s) => ({
        worktrees: {
          ...s.worktrees,
          [repo]: (s.worktrees[repo] ?? []).filter((w) => w.directory !== directory),
        },
      }))
    },
    useBranch: (directory) => useS((s) => (directory ? s.branches[directory] : undefined)),
    listBranches: async () => ["main", "develop", "release/1.4", "opal/rate-limit", "opal/vitest-4"],
    workingDiff: async (directory) =>
      directory === ACME
        ? [README_DIFF]
        : directory === WT_RATE
          ? [RATE_DIFF]
          : directory === WT_VITEST
            ? [JWT_DIFF]
            : [],
    refreshSessionDiff: async () => {},
    listFiles: async (_directory, path) => listMockFiles(path),
    async readFile(_directory, path) {
      const content = MOCK_FILES[path]
      if (content === undefined) throw new Error(`No such file: ${path}`)
      return content
    },
    pty: {
      async create({ directory, title }) {
        const id = `pty_${Math.random().toString(36).slice(2, 8)}`
        shells.set(id, { cwd: directory, title: title ?? "zsh" })
        return { id, directory, title: title ?? "zsh" }
      },
      async list(directory) {
        return [...shells]
          .filter(([, s]) => s.cwd === directory)
          .map(([id, s]) => ({ id, directory, title: s.title }))
      },
      connect(handle: PtyHandle, handlers) {
        // LIMITATION: the mock terminal is a line-echo simulation (pwd, ls, echo, git status), not a shell.
        let line = ""
        const cwd = shells.get(handle.id)?.cwd ?? handle.directory
        const prompt = () => `\x1b[38;5;173m${cwd.split("/").pop()}\x1b[0m \x1b[2m$\x1b[0m `
        const timer = setTimeout(() => {
          handlers.onStatus("open")
          handlers.onData(
            `\x1b[2mMock terminal — commands are simulated (pwd, ls, git status, echo).\x1b[0m\r\n${prompt()}`,
          )
        }, 30)
        const run = (cmd: string) => {
          const [name, ...args] = cmd.trim().split(/\s+/)
          if (!name) return ""
          if (name === "pwd") return `${cwd}\r\n`
          if (name === "ls")
            return `${listMockFiles()
              .map((e) => e.path)
              .join("  ")}\r\n`
          if (name === "echo") return `${args.join(" ")}\r\n`
          if (name === "clear") return "\x1b[2J\x1b[H"
          if (name === "git" && args[0] === "status")
            return `On branch ${mockCodeStore.getState().branches[cwd] ?? "main"}\r\nnothing to commit, working tree clean\r\n`
          return `mock: ${name}: command not simulated\r\n`
        }
        return {
          send(data) {
            for (const ch of data) {
              if (ch === "\r") {
                handlers.onData(`\r\n${run(line)}${prompt()}`)
                line = ""
              } else if (ch === "\x7f") {
                if (line) {
                  line = line.slice(0, -1)
                  handlers.onData("\b \b")
                }
              } else if (ch >= " ") {
                line += ch
                handlers.onData(ch)
              }
            }
          },
          close() {
            clearTimeout(timer)
          },
        }
      },
      resize: async () => {},
      async close(handle) {
        shells.delete(handle.id)
      },
    },
  }
}
