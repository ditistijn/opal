/** Session-level operations of the Runtime contract. */
import { whenReady } from "@/lib/opencode/client"
import { remoteConversationsDir } from "@/lib/opencode/remote-pairing"
import { identifier, newSessionID } from "@/lib/opencode/ids"
import type { ModelRef, PromptMetadata, SessionInfo, SessionMessage } from "@/lib/opencode/types"
import { isTauri } from "@/lib/utils"
import { preparePrompt } from "./attachments"
import type { ChatMessage, ModeID, OpalSessionMetadata, PromptInput, Surface } from "./contracts"
import { PROJECT_KEY, SANDBOX_KEY, projectInstructions, sandboxInstructions } from "./instructions"
import { native } from "./native"
import { armWatchdog, getActivity, limiter, releaseSession } from "./stores/activity"
import { hasAgent } from "./stores/catalog"
import {
  dropMessages,
  fetchAllMessages,
  insertLocalMessage,
  isTracked,
  removeLocalMessage,
} from "./stores/messages"
import {
  getOpalMetadata,
  patchSession,
  removeSession,
  requireSession,
  upsertSession,
} from "./stores/sessions"
import { getSettings } from "./stores/settings"

/** Worktrees created through `createWorktree`, so the session created in them records its repo. */
const worktrees = new Map<string, { repoDirectory: string; branch: string }>()
/** Optimistic user messages still waiting in the limiter queue, per session. */
const queuedLocal = new Map<string, string[]>()

function newMessageID() {
  return "msg_" + identifier(false)
}

async function client() {
  return whenReady()
}

/** Chat sandboxes live in conversations/<sessionID>; uploads always go there (also for Code sessions). */
function isOwnSandbox(session: SessionInfo) {
  const dir = getOpalMetadata(session).directory ?? ""
  return dir.endsWith(`/conversations/${session.id}`)
}

export interface CreateSessionInput {
  surface: Surface
  projectID?: string
  mode?: ModeID
  model?: ModelRef
  title?: string
  directory?: string
  repoDirectory?: string
  worktreeBranch?: string
}

export async function createSession(input: CreateSessionInput): Promise<SessionInfo> {
  const settings = getSettings()
  const project = input.projectID ? settings.projects.find((p) => p.id === input.projectID) : undefined
  const mode: ModeID =
    input.mode ?? project?.defaultMode ?? (input.surface === "chat" ? settings.defaultMode : "code")
  const model = input.model ?? project?.defaultModel ?? settings.defaultModel
  const id = newSessionID()
  let directory = input.directory
  // LIMITATION: the plain-browser build cannot create sandbox folders; its chats use the server's default location.
  if (input.surface === "chat" && !directory && isTauri()) directory = await native.createConversationDir(id)
  // A paired remote device (browser build) creates the sandbox folder on the Mac through the server.
  else if (input.surface === "chat" && !directory) directory = await remoteConversationDir(id)
  const known = directory ? worktrees.get(directory) : undefined
  const worktree = input.repoDirectory
    ? { repoDirectory: input.repoDirectory, branch: input.worktreeBranch ?? known?.branch }
    : known
  const opal: OpalSessionMetadata = {
    surface: input.surface,
    mode,
    ...(input.projectID ? { projectID: input.projectID } : {}),
    ...(directory ? { directory } : {}),
    ...(worktree ? { repoDirectory: worktree.repoDirectory } : {}),
    ...(worktree?.branch ? { worktreeBranch: worktree.branch } : {}),
  }
  const permissions =
    input.surface === "code" && settings.codeSurface.permissionMode === "auto"
      ? [{ action: "*", resource: "*", effect: "allow" as const }]
      : undefined
  const c = await client()
  const session = await c.session.create({
    id,
    title: input.title,
    // Opal's modes are agents defined in opencode.json; fall back to the server default if missing.
    agent: hasAgent(mode) ? mode : undefined,
    model: model
      ? { providerID: model.providerID, id: model.id, ...(model.variant ? { variant: model.variant } : {}) }
      : undefined,
    location: directory ? { directory } : undefined,
    metadata: { opal: { ...opal } },
    permissions,
  })
  upsertSession(session)
  await putInstructions(session, opal).catch((error) =>
    console.warn("[opal:sessions] instructions failed", String(error)),
  )
  return session
}

/** `<Mac conversations folder>/<id>` created via OpenCode's file API, for chats started on a paired device. */
async function remoteConversationDir(id: string): Promise<string | undefined> {
  const base = remoteConversationsDir()
  if (!base) return undefined
  try {
    const c = await client()
    await c.experimental.file.write({
      location: { directory: base },
      path: `${id}/uploads/.keep`,
      payload: new Uint8Array(),
    })
    return `${base.replace(/\/$/, "")}/${id}`
  } catch (error) {
    console.warn("[opal:sessions] could not create a conversation folder on the Mac", String(error))
    return undefined
  }
}

async function putInstructions(session: SessionInfo, opal: OpalSessionMetadata) {
  const c = await client()
  if (opal.surface === "chat" && opal.directory)
    await c.experimental.session.instructions.entry.put({
      sessionID: session.id,
      key: SANDBOX_KEY,
      value: sandboxInstructions(opal.directory),
    })
  const project = opal.projectID ? getSettings().projects.find((p) => p.id === opal.projectID) : undefined
  if (!project) return
  let knowledge = project.knowledge.map((k) => ({ path: k.path, size: k.size }))
  if (isTauri() && isOwnSandbox(session) && project.knowledge.length) {
    // Copy knowledge into the sandbox so the agent reads it without leaving its folder.
    const copied = await native.importUploads(
      session.id,
      project.knowledge.map((k) => k.path),
      [],
      "knowledge",
    )
    knowledge = copied.map((e) => ({ path: e.name, size: e.size }))
  }
  await c.experimental.session.instructions.entry.put({
    sessionID: session.id,
    key: PROJECT_KEY,
    value: projectInstructions(project, knowledge),
  })
}

export async function renameSession(sessionID: string, title: string) {
  await (await client()).session.update({ sessionID, title })
  patchSession(sessionID, (s) => ({ ...s, title }))
}

export async function deleteSession(sessionID: string) {
  const session = await requireSession(sessionID).catch(() => undefined)
  await interrupt(sessionID).catch(() => undefined)
  await (await client()).session.remove({ sessionID })
  removeSession(sessionID)
  dropMessages(sessionID)
  if (isTauri() && session && isOwnSandbox(session))
    await native
      .deleteConversationDir(sessionID)
      .catch((error) => console.warn("[opal:sessions] sandbox removal failed", String(error)))
}

export async function archiveSession(sessionID: string, archived: boolean) {
  await (await client()).session.update({ sessionID, archived })
  patchSession(sessionID, (s) => {
    const { archived: _previous, ...time } = s.time
    return { ...s, time: archived ? { ...time, archived: Date.now() } : time }
  })
}

async function patchOpal(sessionID: string, patch: Partial<OpalSessionMetadata>) {
  const session = await requireSession(sessionID)
  const metadata = { ...(session.metadata ?? {}), opal: { ...getOpalMetadata(session), ...patch } }
  await (await client()).session.update({ sessionID, metadata })
  patchSession(sessionID, (s) => ({ ...s, metadata }))
}

export const starSession = (sessionID: string, starred: boolean) => patchOpal(sessionID, { starred })

export async function setSessionModel(sessionID: string, model: ModelRef) {
  await (
    await client()
  ).session.switchModel({
    sessionID,
    model: {
      providerID: model.providerID,
      id: model.id,
      ...(model.variant ? { variant: model.variant } : {}),
    },
  })
  patchSession(sessionID, (s) => ({ ...s, model }))
}

export async function setSessionMode(sessionID: string, mode: ModeID) {
  await (await client()).session.switchAgent({ sessionID, agent: mode })
  await patchOpal(sessionID, { mode })
  patchSession(sessionID, (s) => ({ ...s, agent: mode }))
}

interface Submission {
  text: string
  files?: { uri: string; name?: string }[]
  metadata?: Record<string, unknown>
  local?: ChatMessage
}

/** Sends through the concurrency limiter; resolves once the server admitted the prompt. */
function submit(sessionID: string, submission: Submission): Promise<void> {
  const messageID = submission.local?.id ?? newMessageID()
  if (submission.local && isTracked(sessionID)) insertLocalMessage(submission.local)
  return new Promise((resolve, reject) => {
    const queued = limiter.isActive(sessionID) ? undefined : messageID
    limiter.acquire(sessionID, () => {
      if (queued)
        queuedLocal.set(
          sessionID,
          (queuedLocal.get(sessionID) ?? []).filter((id) => id !== queued),
        )
      client()
        .then((c) =>
          c.session.prompt({
            sessionID,
            id: messageID,
            text: submission.text,
            files: submission.files,
            metadata: submission.metadata as PromptMetadata | undefined,
          }),
        )
        .then(() => {
          armWatchdog(sessionID)
          resolve()
        })
        .catch((error: unknown) => {
          removeLocalMessage(sessionID, messageID)
          releaseSession(sessionID)
          reject(error instanceof Error ? error : new Error(String(error)))
        })
    })
    if (queued && limiter.isQueued(sessionID))
      queuedLocal.set(sessionID, [...(queuedLocal.get(sessionID) ?? []), queued])
  })
}

export async function sendPrompt(sessionID: string, input: PromptInput) {
  const session = await requireSession(sessionID)
  const directory = getOpalMetadata(session).directory
  const prepared = await preparePrompt(input, sessionID, isOwnSandbox(session) ? directory : undefined)
  const id = newMessageID()
  const local: ChatMessage = {
    id,
    sessionID,
    role: "user",
    kind: "user",
    parts: input.text ? [{ type: "text", text: input.text }] : [],
    attachments: prepared.attachments.length ? prepared.attachments : undefined,
    created: Date.now(),
  }
  await submit(sessionID, { text: prepared.text, files: prepared.files, metadata: prepared.metadata, local })
}

async function waitIdle(sessionID: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (getActivity(sessionID) !== "idle" && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 100))
}

/** Reverts the transcript to just before `messageID` (that message and everything after are removed). */
async function revertTo(sessionID: string, messageID: string) {
  const session = await requireSession(sessionID)
  if (getActivity(sessionID) !== "idle") {
    await interrupt(sessionID)
    await waitIdle(sessionID)
  }
  const c = await client()
  // Restore files too on the Code surface, where reverting a turn should also revert its edits.
  await c.session.revert.stage({ sessionID, messageID, files: getOpalMetadata(session).surface === "code" })
  await c.session.revert.commit({ sessionID })
}

export async function editMessage(sessionID: string, messageID: string, input: PromptInput) {
  await revertTo(sessionID, messageID)
  await sendPrompt(sessionID, input)
}

function resendFiles(message: Extract<SessionMessage, { type: "user" }>) {
  return message.files?.map((f) => ({
    uri: f.source.type === "uri" ? f.source.uri : `data:${f.mime};base64,${f.data}`,
    ...(f.name ? { name: f.name } : {}),
  }))
}

/** Regenerates the last answer: reverts the last user turn and resends it unchanged. */
export async function regenerate(sessionID: string) {
  const list = await fetchAllMessages(sessionID)
  const last = list.findLast((m): m is Extract<SessionMessage, { type: "user" }> => m.type === "user")
  if (!last) throw new Error("Nothing to regenerate")
  await revertTo(sessionID, last.id)
  await submit(sessionID, { text: last.text, files: resendFiles(last), metadata: last.metadata })
}

export async function interrupt(sessionID: string) {
  if (limiter.cancel(sessionID)) {
    for (const id of queuedLocal.get(sessionID) ?? []) removeLocalMessage(sessionID, id)
    queuedLocal.delete(sessionID)
  }
  if (getActivity(sessionID) === "idle" && !limiter.isActive(sessionID)) return
  await (await client()).session.interrupt({ sessionID })
}

// ---------- code surface ----------

export async function listRepos() {
  const projects = await (await client()).project.list()
  return projects
    .filter((p) => !!p.vcs && !/\/conversations\/ses_[^/]+$/.test(p.canonical))
    .map((p) => ({ id: p.id, directory: p.canonical, ...(p.name ? { name: p.name } : {}) }))
}

export function slugify(input: string) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "work"
  )
}

export function defaultBranchName(repoDirectory: string) {
  const name = repoDirectory.split("/").filter(Boolean).pop() ?? "repo"
  const suffix = identifier(false).slice(-4).toLowerCase()
  return `opal/${slugify(name)}-${suffix}`
}

async function runShell(directory: string, command: string, timeoutMs = 15_000) {
  const c = await client()
  const location = { directory }
  const shell = await c.shell.create({ location, command, cwd: directory, timeout: timeoutMs })
  let info = shell.data
  const deadline = Date.now() + timeoutMs
  while (info.status === "running" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150))
    info = (await c.shell.get({ location, id: info.id })).data
  }
  const output = await c.shell
    .output({ location, id: info.id })
    .then((o) => o.data.output)
    .catch(() => "")
  await c.shell.remove({ location, id: info.id }).catch(() => undefined)
  return { ok: info.status === "exited" && info.exit === 0, output }
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export async function createWorktree(repoDirectory: string, base?: string, branch?: string) {
  const c = await client()
  const location = await c.location.get({ location: { directory: repoDirectory } })
  const name = branch ?? defaultBranchName(repoDirectory)
  // `branch` here is the ref `git worktree add --detach` checks out (upstream core/git.ts).
  const info = await c.worktree.create({
    projectID: location.project.id,
    ...(base ? { branch: base } : {}),
    name: slugify(name.split("/").pop() ?? name),
  })
  // Give the detached checkout its own branch so isolated sessions never collide.
  // LIMITATION: worktree.create only checks out a detached ref; the named branch is made with `git switch -c`
  // through the shell API, and on failure the session keeps the detached checkout (docs/LIMITATIONS.md).
  const switched = await runShell(info.directory, `git switch -c ${shellQuote(name)}`).catch(
    (error: unknown) => ({
      ok: false,
      output: String(error),
    }),
  )
  if (!switched.ok)
    console.warn("[opal:worktree] could not create branch", name, switched.output.slice(0, 500))
  const result = { directory: info.directory, branch: switched.ok ? name : (base ?? "HEAD") }
  worktrees.set(info.directory, { repoDirectory, branch: result.branch })
  return result
}
