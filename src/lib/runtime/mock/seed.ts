/**
 * Seed data for the in-memory mock runtime (development with VITE_OPAL_MOCK=1 and tests).
 * Nothing here is ever shown when the real runtime is active.
 */
import type {
  AgentInfo,
  ArtifactContent,
  FileDiff,
  FormInfo,
  ModelInfo,
  ModelRef,
  PermissionRequest,
  ProviderInfo,
  SessionInfo,
} from "@/lib/opencode/types"
import type { AppSettings, ChatMessage, ModeID, OpalSessionMetadata, Project, Surface } from "../contracts"

export const HOUR = 3_600_000
export const DAY = 24 * HOUR

export interface SessionFile {
  path: string
  name: string
  size: number
  modified: number
}

export interface MockSeed {
  sessions: Record<string, SessionInfo>
  messages: Record<string, ChatMessage[]>
  artifacts: Record<string, ArtifactContent>
  activeArtifact: Record<string, string | undefined>
  files: Record<string, SessionFile[]>
  permissions: Record<string, PermissionRequest[]>
  /** Pending OpenCode forms (question tool) per session. */
  forms: Record<string, FormInfo[]>
  diffs: Record<string, FileDiff[]>
  settings: AppSettings
  models: ModelInfo[]
  providers: ProviderInfo[]
  agents: AgentInfo[]
}

export const SANDBOX_ROOT = "/Users/demo/Library/Application Support/Opal/conversations"

export function metadataJson(meta: OpalSessionMetadata): NonNullable<SessionInfo["metadata"]> {
  const clean: Record<string, string | boolean> = {}
  for (const [k, v] of Object.entries(meta)) if (v !== undefined) clean[k] = v as string | boolean
  return { opal: clean }
}

export function makeSession(input: {
  id: string
  title?: string
  surface: Surface
  mode?: ModeID
  projectID?: string
  model?: ModelRef
  created: number
  updated?: number
  starred?: boolean
  directory?: string
  parentID?: string
  repoDirectory?: string
  worktreeBranch?: string
}): SessionInfo {
  const directory = input.directory ?? `${SANDBOX_ROOT}/${input.id}`
  return {
    id: input.id,
    parentID: input.parentID,
    projectID: "global",
    agent: input.mode ?? (input.surface === "code" ? "code" : "artifact"),
    model: input.model,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: input.created, updated: input.updated ?? input.created },
    title: input.title,
    metadata: metadataJson({
      surface: input.surface,
      mode: input.mode ?? (input.surface === "code" ? "code" : "artifact"),
      projectID: input.projectID,
      directory,
      starred: input.starred,
      repoDirectory: input.repoDirectory,
      worktreeBranch: input.worktreeBranch,
    }),
    location: { directory },
  }
}

function model(providerID: string, id: string, name: string, context: number, vision = true): ModelInfo {
  return {
    id,
    modelID: id,
    providerID,
    name,
    capabilities: { tools: true, input: vision ? ["text", "image"] : ["text"], output: ["text"] },
    variants: [],
    time: { released: Date.UTC(2025, 8, 1) },
    cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }],
    status: "active",
    enabled: true,
    limit: { context, output: 32_000 },
  }
}

export const MODELS: ModelInfo[] = [
  model("anthropic", "claude-sonnet-4-5", "Claude Sonnet 4.5", 200_000),
  model("openai", "gpt-5", "GPT-5", 400_000),
  model("zai", "glm-4.6", "GLM-4.6", 200_000, false),
  model("google", "gemini-2.5-pro", "Gemini 2.5 Pro", 1_000_000),
  model("ollama", "qwen3-coder:30b", "Qwen3 Coder 30B", 128_000, false),
]

export const PROVIDERS: ProviderInfo[] = [
  { id: "anthropic", name: "Anthropic", activation: "enabled", package: "@ai-sdk/anthropic" },
  { id: "openai", name: "OpenAI", activation: "enabled", package: "@ai-sdk/openai" },
  { id: "zai", name: "Z.ai", activation: "enabled", package: "@ai-sdk/openai-compatible" },
  { id: "google", name: "Google", activation: "enabled", package: "@ai-sdk/google" },
  { id: "ollama", name: "Ollama", activation: "enabled", package: "@ai-sdk/openai-compatible" },
]

function agent(id: ModeID, name: string, description: string): AgentInfo {
  return {
    id,
    name,
    description,
    mode: "primary",
    hidden: false,
    request: { settings: {}, headers: {}, body: {} },
    permissions: [],
  }
}

export const AGENTS: AgentInfo[] = [
  agent("artifact", "Artifact", "Builds interactive artifacts alongside the conversation"),
  agent("code", "Code", "Writes and edits code in the working directory"),
  agent("general", "General", "Conversational assistant"),
  agent("research", "Research", "Searches the web and cites sources"),
]

export const DEFAULT_MODEL: ModelRef = { providerID: "anthropic", id: "claude-sonnet-4-5" }

const DASHBOARD_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Revenue dashboard</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:28px;background:#fbfaf7;color:#1d1c1a}
  h1{font-size:20px;margin:0 0 4px} p{color:#6b6a65;margin:0 0 20px;font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}
  .kpi{background:#fff;border:1px solid #e7e4da;border-radius:10px;padding:14px}
  .kpi b{display:block;font-size:22px;margin-top:4px} .kpi span{font-size:12px;color:#6b6a65}
  .bars{display:flex;align-items:flex-end;gap:10px;height:180px;background:#fff;border:1px solid #e7e4da;border-radius:10px;padding:16px}
  .bar{flex:1;background:#d97757;border-radius:4px 4px 0 0;opacity:.85}
</style></head>
<body>
  <h1>Q3 Revenue</h1><p>Monthly recurring revenue by month, all regions</p>
  <div class="grid">
    <div class="kpi"><span>MRR</span><b>$482k</b></div>
    <div class="kpi"><span>Growth</span><b>+12.4%</b></div>
    <div class="kpi"><span>Churn</span><b>1.8%</b></div>
  </div>
  <div class="bars">${[38, 46, 52, 49, 61, 66, 72, 78, 84]
    .map((h) => `<div class="bar" style="height:${h}%"></div>`)
    .join("")}</div>
</body></html>`

const DASHBOARD_ANSWER = `I've built an interactive **Q3 revenue dashboard** from your spreadsheet. It shows three headline KPIs and a monthly bar chart.

A few observations from the data:

1. **MRR grew 12.4%** quarter over quarter, driven mostly by the enterprise tier.
2. Churn stayed flat at **1.8%**, slightly below the trailing average.
3. September was the strongest month — worth checking whether the annual-plan promotion pulled revenue forward.

The aggregation I used:

\`\`\`python
import pandas as pd

df = pd.read_csv("uploads/revenue-q3.csv", parse_dates=["date"])
monthly = (
    df.groupby(df["date"].dt.to_period("M"))["mrr"]
      .sum()
      .reset_index()
)
growth = monthly["mrr"].pct_change().fillna(0)
print(monthly.assign(growth=growth.round(3)))
\`\`\`

| Month | MRR | Growth |
| --- | ---: | ---: |
| July | $431k | — |
| August | $455k | 5.6% |
| September | $482k | 5.9% |

Want me to add a breakdown by region or export the chart as a PNG?`

const RUST_ANSWER = `Use \`Arc<Mutex<T>>\` when several threads need to **mutate** shared state, and \`Arc<RwLock<T>>\` when reads vastly outnumber writes.

\`\`\`rust
use std::sync::{Arc, Mutex};
use std::thread;

fn main() {
    let counter = Arc::new(Mutex::new(0));
    let handles: Vec<_> = (0..8)
        .map(|_| {
            let c = Arc::clone(&counter);
            thread::spawn(move || *c.lock().unwrap() += 1)
        })
        .collect();
    for h in handles { h.join().unwrap(); }
    println!("count = {}", *counter.lock().unwrap());
}
\`\`\`

> Tip: keep the critical section small — clone the data out of the guard before doing slow work.`

export function makeSeed(now = Date.now()): MockSeed {
  const sessions: Record<string, SessionInfo> = {}
  const messages: Record<string, ChatMessage[]> = {}
  const add = (s: SessionInfo, msgs: ChatMessage[] = []) => {
    sessions[s.id] = s
    messages[s.id] = msgs
  }

  const dash = makeSession({
    id: "ses_dashboard",
    title: "Q3 revenue dashboard",
    surface: "chat",
    model: DEFAULT_MODEL,
    created: now - 50 * 60_000,
    updated: now - 12 * 60_000,
    starred: true,
  })
  add(dash, [
    {
      id: "msg_d1",
      sessionID: dash.id,
      role: "user",
      kind: "user",
      parts: [
        { type: "text", text: "Can you turn this spreadsheet into a dashboard with the key Q3 numbers?" },
      ],
      attachments: [
        {
          name: "revenue-q3.csv",
          mime: "text/csv",
          size: 48_213,
          uri: `file://${SANDBOX_ROOT}/ses_dashboard/uploads/revenue-q3.csv`,
        },
      ],
      created: now - 14 * 60_000,
    },
    {
      id: "msg_d2",
      sessionID: dash.id,
      role: "assistant",
      kind: "assistant",
      model: DEFAULT_MODEL,
      agent: "artifact",
      parts: [
        {
          type: "reasoning",
          text: "The CSV has a date column and an mrr column per account. I should aggregate by month, compute growth and churn, then build a single-file HTML dashboard with KPIs and a bar chart.",
          time: { created: now - 14 * 60_000, completed: now - 14 * 60_000 + 6_000 },
        },
        {
          type: "tool",
          id: "tool_d1",
          name: "read",
          status: "completed",
          input: { filePath: "uploads/revenue-q3.csv" },
          output: "date,account,mrr\n2025-07-01,acme,1200\n2025-07-01,globex,860\n… (1,204 rows)",
          time: { created: now - 14 * 60_000 + 7_000, completed: now - 14 * 60_000 + 8_000 },
        },
        {
          type: "tool",
          id: "tool_d2",
          name: "artifact_create",
          status: "completed",
          input: { title: "Q3 revenue dashboard", entry: "index.html" },
          output: "Created artifact art_dashboard",
          metadata: { artifactID: "art_dashboard" },
          time: { created: now - 14 * 60_000 + 9_000, completed: now - 14 * 60_000 + 20_000 },
        },
        { type: "text", text: DASHBOARD_ANSWER },
      ],
      created: now - 14 * 60_000 + 1_000,
      completed: now - 12 * 60_000,
      tokens: { input: 18_204, output: 1_312, reasoning: 220 },
      cost: 0.0743,
      changedFiles: ["dashboard.html"],
    },
  ])

  const rust = makeSession({
    id: "ses_rust",
    title: "Sharing state across threads in Rust",
    surface: "chat",
    mode: "general",
    model: { providerID: "openai", id: "gpt-5" },
    created: now - 3 * HOUR,
    updated: now - 2.5 * HOUR,
  })
  add(rust, [
    {
      id: "msg_r1",
      sessionID: rust.id,
      role: "user",
      kind: "user",
      parts: [{ type: "text", text: "When should I use Arc<Mutex<T>> vs RwLock?" }],
      created: now - 2.6 * HOUR,
    },
    {
      id: "msg_r2",
      sessionID: rust.id,
      role: "assistant",
      kind: "assistant",
      model: { providerID: "openai", id: "gpt-5" },
      parts: [{ type: "text", text: RUST_ANSWER }],
      created: now - 2.6 * HOUR + 2000,
      completed: now - 2.5 * HOUR,
      tokens: { input: 812, output: 402 },
      cost: 0.0061,
    },
  ])

  const simple = (
    id: string,
    title: string,
    ago: number,
    extra: Partial<Parameters<typeof makeSession>[0]> = {},
  ) =>
    add(
      makeSession({
        id,
        title,
        surface: "chat",
        model: DEFAULT_MODEL,
        created: now - ago - HOUR,
        updated: now - ago,
        ...extra,
      }),
      [
        {
          id: `${id}_u`,
          sessionID: id,
          role: "user",
          kind: "user",
          parts: [{ type: "text", text: title }],
          created: now - ago - 60_000,
        },
        {
          id: `${id}_a`,
          sessionID: id,
          role: "assistant",
          kind: "assistant",
          parts: [
            {
              type: "text",
              text: `Here's a quick take on **${title.toLowerCase()}**.\n\n- Start with the constraints\n- Sketch two options\n- Pick the simpler one`,
            },
          ],
          created: now - ago - 50_000,
          completed: now - ago,
        },
      ],
    )

  simple("ses_espresso", "Dialing in a new espresso grinder", 5 * HOUR)
  simple("ses_trip", "Weekend itinerary for Lisbon", DAY + 2 * HOUR, { starred: true })
  simple("ses_email", "Draft a polite follow-up email", DAY + 6 * HOUR)
  simple("ses_flow", "Onboarding flow diagram", 3 * DAY)
  simple("ses_okr", "Q4 OKR brainstorm", 4 * DAY, { projectID: "prj_launch" })
  simple("ses_pricing", "Pricing page copy review", 6 * DAY, { projectID: "prj_launch" })
  simple("ses_sql", "Window functions in Postgres", 12 * DAY)
  simple("ses_garden", "Raised bed garden layout", 24 * DAY)
  simple("ses_reading", "Summary of the attention paper", 40 * DAY, { projectID: "prj_research" })

  // Code-surface sessions (for the code surface's development).
  add(
    makeSession({
      id: "ses_code_auth",
      title: "Fix flaky auth middleware test",
      surface: "code",
      mode: "code",
      model: DEFAULT_MODEL,
      created: now - 2 * HOUR,
      directory: "/Users/demo/Developer/acme-api",
    }),
    [],
  )

  const artifacts: Record<string, ArtifactContent> = {
    art_dashboard: {
      info: {
        id: "art_dashboard",
        provider: "local",
        sessionID: dash.id,
        title: "Q3 revenue dashboard",
        entry: "index.html",
        url: "",
        time: { created: now - 13 * 60_000, updated: now - 12 * 60_000 },
      },
      files: { "index.html": DASHBOARD_HTML },
    },
  }

  const files: Record<string, SessionFile[]> = {
    [dash.id]: [
      {
        path: `${SANDBOX_ROOT}/ses_dashboard/uploads/revenue-q3.csv`,
        name: "revenue-q3.csv",
        size: 48_213,
        modified: now - 14 * 60_000,
      },
      {
        path: `${SANDBOX_ROOT}/ses_dashboard/dashboard.html`,
        name: "dashboard.html",
        size: 2_940,
        modified: now - 12 * 60_000,
      },
      {
        path: `${SANDBOX_ROOT}/ses_dashboard/monthly.csv`,
        name: "monthly.csv",
        size: 312,
        modified: now - 12 * 60_000,
      },
    ],
  }

  const projects: Project[] = [
    {
      id: "prj_launch",
      name: "Opal launch",
      description: "Positioning, pricing and launch planning for the 1.0 release.",
      instructions:
        "You are helping plan the Opal 1.0 launch. Keep answers concise, cite numbers from the knowledge files, and flag assumptions explicitly.",
      knowledge: [
        {
          name: "positioning.md",
          path: "/Users/demo/Library/Application Support/Opal/projects/prj_launch/knowledge/positioning.md",
          size: 8_420,
          added: now - 6 * DAY,
        },
        {
          name: "pricing-research.pdf",
          path: "/Users/demo/Library/Application Support/Opal/projects/prj_launch/knowledge/pricing-research.pdf",
          size: 1_204_331,
          added: now - 5 * DAY,
        },
        {
          name: "competitors.csv",
          path: "/Users/demo/Library/Application Support/Opal/projects/prj_launch/knowledge/competitors.csv",
          size: 12_002,
          added: now - 5 * DAY,
        },
      ],
      defaultMode: "artifact",
      created: now - 8 * DAY,
      updated: now - 4 * DAY,
    },
    {
      id: "prj_research",
      name: "Reading list",
      description: "Papers and notes on sequence models.",
      knowledge: [],
      created: now - 45 * DAY,
      updated: now - 40 * DAY,
    },
  ]

  const settings: AppSettings = {
    theme: "system",
    maxConcurrentConnections: 3,
    defaultModel: DEFAULT_MODEL,
    defaultMode: "artifact",
    promptOverrides: {},
    providers: [],
    projects,
    codeSurface: { useWorktrees: true, permissionMode: "ask" },
    sidebarCollapsed: false,
    lastSurface: "chat",
    sandbox: { mode: "filesystem", allowPaths: [] },
    remote: { enabled: false, lan: true },
    updates: { autoCheck: true },
  }

  return {
    sessions,
    messages,
    artifacts,
    activeArtifact: { [dash.id]: "art_dashboard" },
    files,
    permissions: {},
    forms: {},
    diffs: {
      ses_code_auth: [
        {
          file: "src/middleware/auth.ts",
          patch:
            '@@ -12,7 +12,7 @@\n-  const token = req.headers.authorization\n+  const token = req.headers.authorization?.replace(/^Bearer /, "")\n',
          additions: 1,
          deletions: 1,
          status: "modified",
        },
      ],
    },
    settings,
    models: MODELS,
    providers: PROVIDERS,
    agents: AGENTS,
  }
}
