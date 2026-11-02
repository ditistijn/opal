/**
 * The two acceptance phases, driven against the real runtime (stores + sidecar) inside the desktop app.
 * Hooks are not usable here, so everything reads the underlying Zustand stores the hooks wrap.
 */
import { invoke } from "@tauri-apps/api/core"
import { useNav } from "@/features/chat/nav-store"
import { serverStore, whenReady } from "@/lib/opencode/client"
import type { ModelRef } from "@/lib/opencode/types"
import { runtime, type ChatMessage } from "@/lib/runtime"
import { native } from "@/lib/runtime/native"
import { activityStore, getActivity } from "@/lib/runtime/stores/activity"
import { artifactsStore, getArtifactContent, loadArtifacts } from "@/lib/runtime/stores/artifacts"
import { catalogStore, refreshCatalog } from "@/lib/runtime/stores/catalog"
import { getMessages, loadMessages } from "@/lib/runtime/stores/messages"
import { permissionsStore } from "@/lib/runtime/stores/permissions"
import { getOpalMetadata, selectSessions, sessionsStore } from "@/lib/runtime/stores/sessions"
import { getSettings, loadSettings } from "@/lib/runtime/stores/settings"
import type { SmokeConfig } from "./config"
import { htmlProblem } from "./content"
import { isNarrowLayout, nonceOf, readPreview, trackPreview } from "./dom"
import type { Detail, Recorder } from "./report"
import { assert, errorMessage, waitFor } from "./wait"

const ARTIFACT_ORIGIN = "artifact://localhost/"
const SERVER_TIMEOUT_MS = 120_000
const RENDER_TIMEOUT_MS = 90_000

interface OpalPathsJSON {
  root: string
  conversations_dir: string
}

const modelKey = (m: ModelRef) => `${m.providerID}/${m.id}`

function textOf(message: ChatMessage) {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim()
}

// ---------- shared steps ----------

async function serverReady(rec: Recorder) {
  await rec.step("server", "Engine (sidecar) ready, Opal config applied", async (d) => {
    const client = whenReady()
    const status = await waitFor(
      "the engine to become ready",
      () => {
        const s = serverStore.getState().status
        return s.state === "ready" ? s : undefined
      },
      {
        timeoutMs: SERVER_TIMEOUT_MS,
        describe: () => {
          const s = serverStore.getState().status
          return `state ${s.state}${"message" in s && s.message ? `: ${s.message}` : ""}`
        },
      },
    )
    await client
    rec.env.serverURL = status.url
    rec.env.version = status.version
    d.serverURL = status.url
    d.version = status.version
    try {
      const { getVersion } = await import("@tauri-apps/api/app")
      rec.env.appVersion = await getVersion()
    } catch {
      // not essential
    }
    // boot() regenerates opencode.json once per launch; Opal's agents appear after that write + reload.
    let lastRefresh = 0
    await waitFor(
      "Opal's agents (artifact mode) in the catalog",
      async () => {
        if (Date.now() - lastRefresh > 2000) {
          lastRefresh = Date.now()
          await refreshCatalog()
        }
        return catalogStore.getState().agents.some((a) => a.id === "artifact") ? true : undefined
      },
      {
        timeoutMs: 90_000,
        describe: () =>
          `agents: ${
            catalogStore
              .getState()
              .agents.map((a) => a.id)
              .join(", ") || "none"
          }`,
      },
    )
    const settings = await loadSettings()
    d.agents = catalogStore.getState().agents.map((a) => a.id)
    d.sandbox = settings.sandbox.mode
  })
}

async function waitForModel(model: ModelRef, timeoutMs: number) {
  let lastRefresh = 0
  return waitFor(
    `model ${modelKey(model)} in the catalog`,
    async () => {
      if (Date.now() - lastRefresh > 2000) {
        lastRefresh = Date.now()
        await refreshCatalog()
      }
      return catalogStore
        .getState()
        .models.find((m) => m.providerID === model.providerID && m.id === model.id)
    },
    {
      timeoutMs,
      describe: () => {
        const models = catalogStore.getState().models
        const similar = models.filter((m) => m.id === model.id).map((m) => modelKey(m))
        return `${models.length} models listed${similar.length ? `; same id under: ${similar.join(", ")}` : ""}`
      },
    },
  )
}

/** Sends a prompt and waits until the session has been busy and is idle again (auto-approving permissions). */
async function runTurn(sessionID: string, text: string, timeoutMs: number, d: Detail) {
  let sawBusy = getActivity(sessionID) !== "idle"
  const approved: string[] = []
  const replied = new Set<string>()
  const unsubActivity = activityStore.subscribe(() => {
    if (getActivity(sessionID) !== "idle") sawBusy = true
  })
  const unsubPermissions = permissionsStore.subscribe((s) => {
    for (const request of s.bySession[sessionID] ?? []) {
      if (replied.has(request.id)) continue
      replied.add(request.id)
      approved.push(`${request.action} ${(request.resources ?? []).join(" ")}`.trim().slice(0, 200))
      void runtime.replyPermission(sessionID, request.id, "once").catch(() => undefined)
    }
  })
  const started = Date.now()
  try {
    await runtime.sendPrompt(sessionID, { text })
    let lastActiveCheck = 0
    await waitFor(
      "the turn to finish (session idle)",
      async () => {
        if (getActivity(sessionID) !== "idle") {
          sawBusy = true
          return undefined
        }
        if (sawBusy) return true
        // Never observed busy: accept once the server reports the session inactive (after a grace period).
        if (Date.now() - started > 20_000 && Date.now() - lastActiveCheck > 2000) {
          lastActiveCheck = Date.now()
          const active = await (await whenReady()).session.active()
          if (!active[sessionID]) return true
        }
        return undefined
      },
      {
        timeoutMs,
        describe: () => {
          const errors = getMessages(sessionID)
            .filter((m) => m.role === "assistant" && m.created >= started && m.error)
            .map((m) => m.error!)
          const last = errors.at(-1)
          return `activity ${getActivity(sessionID)}, busy seen: ${sawBusy}${
            errors.length ? `, ${errors.length} failed attempt(s), last: ${last!.slice(0, 200)}` : ""
          }`
        },
      },
    )
  } finally {
    unsubActivity()
    unsubPermissions()
  }
  d.turnMs = Date.now() - started
  if (approved.length) d.permissionsApproved = approved
}

/** Messages of the turn started by `prompt` (from the server, via the messages projection). */
async function turnReply(sessionID: string, prompt: string) {
  const needle = prompt.slice(0, 40)
  return waitFor(
    "an assistant reply with text",
    async () => {
      await loadMessages(sessionID)
      const messages = getMessages(sessionID)
      const start = messages.findLastIndex((m) => m.role === "user" && textOf(m).includes(needle))
      if (start < 0) return undefined
      const assistant = messages.slice(start + 1).filter((m) => m.role === "assistant")
      const errors = assistant.map((m) => m.error).filter((e): e is string => !!e)
      const text = assistant.map(textOf).filter(Boolean)
      if (!text.length && errors.length) throw new Error(`assistant error: ${errors.at(-1)}`)
      if (!text.length) return undefined
      const tools = [
        ...new Set(assistant.flatMap((m) => m.parts.flatMap((p) => (p.type === "tool" ? [p.name] : [])))),
      ]
      return { assistant, text, errors, tools }
    },
    { timeoutMs: 30_000, intervalMs: 1000 },
  )
}

async function waitRendered(
  artifactID: string,
  timeoutMs: number,
  accept?: (src: string | undefined) => boolean,
) {
  return waitFor(
    `the preview of ${artifactID} to render`,
    () => {
      const p = readPreview(artifactID)
      return p?.status === "rendered" && (!accept || accept(p.src)) ? p : undefined
    },
    {
      timeoutMs,
      describe: () => {
        const p = readPreview(artifactID)
        return p ? `status ${p.status}, src ${p.src ?? "none"}` : "preview not in the DOM"
      },
      fail: () => {
        const p = readPreview(artifactID)
        return p?.status === "error" ? `render error: ${p.error || "unknown"}` : undefined
      },
    },
  )
}

function versionsOf(artifactID: string) {
  return artifactsStore.getState().views[artifactID]?.versions ?? []
}

// ---------- phase: create ----------

export async function createPhase(rec: Recorder, config: SmokeConfig) {
  await serverReady(rec)

  await rec.step("provider", "Provider + model configured, defaults saved", async (d) => {
    if (config.importCliConfig) {
      const { imported } = await runtime.importOpenCodeConfig()
      d.imported = imported
      assert(imported >= 1, "no provider imported from ~/.config/opencode (opencode.json)")
    }
    if (config.provider) {
      await runtime.saveProvider(config.provider)
      d.saved = config.provider.id
    }
    d.providers = getSettings().providers.map((p) => `${p.id} (${p.models.length} models)`)
    await runtime.refreshCatalog()
    const model = config.model ?? getSettings().defaultModel
    assert(model, "no model requested and no default model available")
    const info = await waitForModel(model, 60_000)
    d.model = modelKey(model)
    d.modelName = info.name
    await runtime.updateSettings({ defaultModel: model, defaultMode: "artifact", lastSurface: "chat" })
    const saved = getSettings()
    assert(
      saved.defaultModel &&
        modelKey(saved.defaultModel) === modelKey(model) &&
        saved.defaultMode === "artifact",
      "settings did not keep defaultModel/defaultMode",
    )
  })

  let sessionID = ""
  let directory = ""
  await rec.step("session", "Chat conversation created in its sandbox and opened", async (d) => {
    const model = getSettings().defaultModel
    const session = await runtime.createSession({ surface: "chat", mode: "artifact", model })
    sessionID = session.id
    rec.extra.sessionID = sessionID
    d.sessionID = sessionID
    directory = getOpalMetadata(session).directory ?? ""
    rec.extra.directory = directory
    d.directory = directory
    d.agent = session.agent
    const paths = await invoke<OpalPathsJSON>("cmd_paths")
    const expected = `${paths.conversations_dir.replace(/\/$/, "")}/${sessionID}`
    assert(directory === expected, `session directory ${directory || "(none)"} is not ${expected}`)
    const stat = await invoke<{ exists: boolean; isDir: boolean }>("cmd_smoke_stat", { path: directory })
    assert(stat.isDir, `sandbox directory does not exist: ${directory}`)
    await runtime.updateSettings({ lastSurface: "chat" })
    useNav.getState().go({ kind: "session", sessionID })
    useNav.getState().setNarrowTab("artifact")
  })

  let artifactID = ""
  let htmlFile = ""
  await rec.step("turn1", "Prompt 1 → assistant reply + HTML artifact", async (d) => {
    d.prompt = config.prompt1
    await runTurn(sessionID, config.prompt1, config.timeoutMs, d)
    const reply = await turnReply(sessionID, config.prompt1)
    d.assistantMessages = reply.assistant.length
    d.replyChars = reply.text.join("").length
    d.tools = reply.tools
    if (reply.errors.length) d.assistantErrors = reply.errors
    const found = await waitFor(
      "an artifact with an .html file",
      async () => {
        await loadArtifacts(sessionID)
        const list = artifactsStore.getState().bySession[sessionID] ?? []
        for (const info of [...list].reverse()) {
          const content = await getArtifactContent(info.id)
          const files = Object.keys(content.files)
          const html = info.entry.endsWith(".html") ? info.entry : files.find((f) => f.endsWith(".html"))
          if (html) return { info, files, html, count: list.length, text: content.files[html] ?? "" }
        }
        return undefined
      },
      {
        timeoutMs: 30_000,
        intervalMs: 1000,
        describe: () => `${(artifactsStore.getState().bySession[sessionID] ?? []).length} artifacts`,
      },
    )
    artifactID = found.info.id
    htmlFile = found.html
    rec.extra.artifactID = artifactID
    Object.assign(d, {
      artifactID,
      title: found.info.title,
      entry: found.info.entry,
      files: found.files,
      htmlChars: found.text.length,
      artifacts: found.count,
    })
    const problem = htmlProblem(found.text)
    assert(!problem, `artifact ${artifactID} ${htmlFile}: ${problem}`)
  })

  await rec.step("preview1", "artifact:// serves the file; preview opens and renders", async (d) => {
    const file = await invoke<{ status: number; mime: string; bytes: number }>("cmd_smoke_artifact_file", {
      artifactId: artifactID,
      path: htmlFile,
    })
    d.protocol = file
    assert(file.status === 200, `artifact://${artifactID}/${htmlFile} → ${file.status} ${file.mime}`)
    assert(file.mime.startsWith("text/html"), `unexpected content type ${file.mime}`)
    d.activeBefore = artifactsStore.getState().active[sessionID] ?? null
    const opened = await waitFor("the artifact pane to open by itself", () => readPreview(artifactID), {
      timeoutMs: 30_000,
      describe: () =>
        `active ${String(artifactsStore.getState().active[sessionID])}, narrow ${isNarrowLayout()}`,
    }).catch((error: unknown) => {
      d.autoOpenError = errorMessage(error)
      return undefined
    })
    d.autoOpened = !!opened
    d.layout = isNarrowLayout() ? "narrow" : "split"
    assert(opened, `the preview did not open automatically: ${String(d.autoOpenError)}`)
    const rendered = await waitRendered(artifactID, RENDER_TIMEOUT_MS)
    d.src = rendered.src
    assert(
      rendered.src?.startsWith(`${ARTIFACT_ORIGIN}`),
      `iframe src is not on ${ARTIFACT_ORIGIN}: ${rendered.src}`,
    )
    d.versions = versionsOf(artifactID).length
  })

  await rec.step("turn2", "Prompt 2 updates the same artifact; preview refreshes", async (d) => {
    d.prompt = config.prompt2
    const before = artifactsStore.getState().views[artifactID]?.info
    assert(before, `artifact ${artifactID} is not loaded`)
    const updatedBefore = before.time.updated
    const srcBefore = readPreview(artifactID)?.src
    const tracker = trackPreview(artifactID)
    try {
      await runTurn(sessionID, config.prompt2, config.timeoutMs, d)
      const reply = await turnReply(sessionID, config.prompt2)
      d.tools = reply.tools
      d.replyChars = reply.text.join("").length
      if (reply.errors.length) d.assistantErrors = reply.errors
      const after = await waitFor(
        `artifact ${artifactID} to get a newer time.updated`,
        async () => {
          await loadArtifacts(sessionID)
          const info = (artifactsStore.getState().bySession[sessionID] ?? []).find((a) => a.id === artifactID)
          return info && info.time.updated > updatedBefore ? info : undefined
        },
        {
          timeoutMs: 30_000,
          intervalMs: 1000,
          describe: () =>
            `artifacts now: ${(artifactsStore.getState().bySession[sessionID] ?? []).map((a) => a.id).join(", ")}`,
        },
      )
      d.updated = { before: updatedBefore, after: after.time.updated }
      d.artifacts = (artifactsStore.getState().bySession[sessionID] ?? []).length
      const content = await getArtifactContent(artifactID)
      d.files = Object.keys(content.files)
      const html = content.info.entry.endsWith(".html")
        ? content.info.entry
        : Object.keys(content.files).find((f) => f.endsWith(".html"))
      const text = html ? (content.files[html] ?? "") : ""
      d.htmlChars = text.length
      const problem = html ? htmlProblem(text) : "the updated artifact has no .html file"
      assert(!problem, `updated artifact ${artifactID}: ${problem}`)
      const rendered = await waitRendered(artifactID, RENDER_TIMEOUT_MS, (src) => src !== srcBefore)
      d.src = rendered.src
      d.nonce = { before: nonceOf(srcBefore), after: nonceOf(rendered.src) }
      const statuses = tracker.events.filter((e) => e.kind === "status").map((e) => e.value)
      const loads = tracker.events.filter((e) => e.kind === "load").length
      d.statusTransitions = statuses
      d.iframeLoads = loads
      const recycled =
        statuses.lastIndexOf("rendered") > Math.max(statuses.indexOf("loading"), -1) &&
        statuses.includes("loading")
      assert(rendered.src !== srcBefore || recycled, "the preview did not reload after the update")
      const versions = await waitFor(
        "≥2 version snapshots",
        () => {
          const list = versionsOf(artifactID)
          return list.length >= 2 ? list : undefined
        },
        { timeoutMs: 30_000, describe: () => `${versionsOf(artifactID).length} versions` },
      ).catch(async (error: unknown) => {
        d.versionsOnDisk = (await native.listArtifactVersions(artifactID).catch(() => [])).length
        throw error
      })
      d.versions = versions.map((v) => ({ n: v.n, time: v.time }))
    } finally {
      tracker.stop()
    }
  })
}

// ---------- phase: reopen ----------

export async function reopenPhase(rec: Recorder, config: SmokeConfig) {
  const sessionID = config.sessionID!
  const artifactID = config.artifactID!
  rec.extra.sessionID = sessionID
  rec.extra.artifactID = artifactID
  await serverReady(rec)

  await rec.step("settings", "Settings and providers persisted across relaunch", async (d) => {
    const s = await loadSettings()
    d.defaultModel = s.defaultModel ? modelKey(s.defaultModel) : null
    d.defaultMode = s.defaultMode
    d.providers = s.providers.map((p) => p.id)
    assert(s.providers.length >= 1, "no providers in settings.json after relaunch")
    assert(s.defaultModel, "no default model in settings.json after relaunch")
    if (config.model) assert(modelKey(s.defaultModel) === modelKey(config.model), "default model changed")
    const model = await waitForModel(s.defaultModel, 60_000)
    d.modelListed = modelKey(model)
  })

  await rec.step("listed", "Conversation listed in the chat sidebar data", async (d) => {
    const session = await waitFor(
      `session ${sessionID} in the chat list`,
      () =>
        selectSessions(sessionsStore.getState().byID, { surface: "chat" }).find((s) => s.id === sessionID),
      {
        timeoutMs: 60_000,
        describe: () =>
          `loaded ${sessionsStore.getState().loaded}, ${Object.keys(sessionsStore.getState().byID).length} sessions`,
      },
    )
    d.title = session.title
    const directory = getOpalMetadata(session).directory
    rec.extra.directory = directory
    d.directory = directory
    useNav.getState().go({ kind: "session", sessionID })
    useNav.getState().setNarrowTab("artifact")
  })

  await rec.step("messages", "Messages load (≥2 user turns)", async (d) => {
    const messages = await waitFor(
      "the transcript",
      async () => {
        await loadMessages(sessionID)
        const list = getMessages(sessionID)
        return list.filter((m) => m.role === "user").length >= 2 ? list : undefined
      },
      {
        timeoutMs: 60_000,
        intervalMs: 1000,
        describe: () => `${getMessages(sessionID).filter((m) => m.role === "user").length} user messages`,
      },
    )
    d.user = messages.filter((m) => m.role === "user").length
    d.assistant = messages.filter((m) => m.role === "assistant").length
  })

  await rec.step("artifact", "Artifact listed; pane opens by default and renders", async (d) => {
    const list = await waitFor(
      `artifact ${artifactID} in the conversation`,
      async () => {
        await loadArtifacts(sessionID)
        const l = artifactsStore.getState().bySession[sessionID]
        return l?.some((a) => a.id === artifactID) ? l : undefined
      },
      { timeoutMs: 60_000, intervalMs: 1000 },
    )
    d.artifacts = list.map((a) => a.id)
    d.active = artifactsStore.getState().active[sessionID] ?? null
    const rendered = await waitRendered(artifactID, RENDER_TIMEOUT_MS)
    d.layout = isNarrowLayout() ? "narrow" : "split"
    d.src = rendered.src
    assert(rendered.src?.startsWith(`${ARTIFACT_ORIGIN}${artifactID}`), `iframe src is ${rendered.src}`)
    d.versions = versionsOf(artifactID).length
  })
}
