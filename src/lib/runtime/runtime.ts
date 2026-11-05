/**
 * The real Runtime: Zustand stores fed by one SSE subscription to the OpenCode server.
 * Booting (connect + event loop + settings + config sync) happens lazily on first use, so importing
 * the runtime in tests or before the server exists has no side effects.
 */
import { useEffect } from "react"
import { useStore } from "zustand"
import { connect, restartServer, serverStore, whenReady } from "@/lib/opencode/client"
import { isTauri } from "@/lib/utils"
import type { AppSettings, Runtime } from "./contracts"
import { startEventLoop } from "./events"
import { native } from "./native"
import { configureSandbox } from "./sandbox"
import { syncRemote } from "./remote"
import { addProjectKnowledge, deleteProject, saveProject } from "./projects"
import {
  applyConfig,
  deleteProvider,
  getPrompt,
  importOpenCodeConfig,
  saveProvider,
  setPromptOverride,
  testProvider,
} from "./providers"
import * as api from "./sessions-api"
import { limiter, useSessionActivity } from "./stores/activity"
import {
  getArtifactContent,
  restoreArtifactVersion,
  updateArtifact,
  useActiveArtifact,
  useArtifact,
  useArtifacts,
} from "./stores/artifacts"
import { refreshCatalog, useAgents, useModels, useProviders } from "./stores/catalog"
import { useSessionDiff, useSessionFiles } from "./stores/files"
import { cancelForm, replyForm, useForms } from "./stores/forms"
import { useMessages } from "./stores/messages"
import { replyPermission, usePermissions } from "./stores/permissions"
import { getOpalMetadata, useChildSessions, useSession, useSessions } from "./stores/sessions"
import { loadSettings, settingsStore, updateSettings, useSettings } from "./stores/settings"

let booted = false

/** Connects to the server and starts the event loop (idempotent). */
export function boot() {
  if (booted) return
  booted = true
  connect()
  startEventLoop()
  void loadSettings().then(async (settings) => {
    // The wrapper's config.env follows settings (also repairs a deleted/stale file) before the config sync.
    await configureSandbox(settings.sandbox).catch((error) =>
      console.warn("[opal:sandbox] configure failed", String(error)),
    )
    void syncRemote(settings.remote)
    await whenReady()
    // Bring opencode.json in line with settings (agents/prompts/providers) once per launch.
    await applyConfig().catch((error) => console.warn("[opal:runtime] config sync failed", String(error)))
  })
  // A higher concurrency limit starts waiting prompts right away.
  settingsStore.subscribe((s, prev) => {
    if (s.settings.maxConcurrentConnections !== prev.settings.maxConcurrentConnections) limiter.pump()
  })
}

function useBooted() {
  useEffect(boot, [])
}

function useServer() {
  useBooted()
  return useStore(serverStore, (s) => s.status)
}

async function withBoot<T>(fn: () => Promise<T>): Promise<T> {
  boot()
  return fn()
}

export function makeRuntime(): Runtime {
  return {
    useServer,
    restartServer: () => withBoot(restartServer),

    useSessions: (filter) => {
      useBooted()
      return useSessions(filter)
    },
    useSession,
    useChildSessions,
    createSession: (input) => withBoot(() => api.createSession(input)),
    renameSession: (id, title) => withBoot(() => api.renameSession(id, title)),
    deleteSession: (id) => withBoot(() => api.deleteSession(id)),
    archiveSession: (id, archived) => withBoot(() => api.archiveSession(id, archived)),
    starSession: (id, starred) => withBoot(() => api.starSession(id, starred)),
    setSessionModel: (id, model) => withBoot(() => api.setSessionModel(id, model)),
    setSessionMode: (id, mode) => withBoot(() => api.setSessionMode(id, mode)),
    getOpalMetadata,

    useMessages,
    useSessionActivity,
    sendPrompt: (id, input) => withBoot(() => api.sendPrompt(id, input)),
    editMessage: (id, messageID, input) => withBoot(() => api.editMessage(id, messageID, input)),
    regenerate: (id) => withBoot(() => api.regenerate(id)),
    interrupt: (id) => withBoot(() => api.interrupt(id)),

    usePermissions,
    replyPermission: (id, requestID, decision) => withBoot(() => replyPermission(id, requestID, decision)),

    useForms,
    replyForm: (id, formID, answer) => withBoot(() => replyForm(id, formID, answer)),
    cancelForm: (id, formID, message) => withBoot(() => cancelForm(id, formID, message)),

    useModels,
    useProviders,
    useAgents,
    refreshCatalog: () => withBoot(refreshCatalog),

    useArtifacts,
    useArtifact,
    getArtifactContent: (id) => withBoot(() => getArtifactContent(id)),
    updateArtifact: (id, files, title) => withBoot(() => updateArtifact(id, files, title)),
    restoreArtifactVersion: (id, n) => withBoot(() => restoreArtifactVersion(id, n)),
    useActiveArtifact,

    useSessionFiles,
    revealPath: async (path) => {
      if (isTauri()) return native.revealPath(path)
      console.warn("[opal:files] reveal is only available in the desktop app")
    },
    openPath: async (path) => {
      if (isTauri()) return native.openPath(path)
      console.warn("[opal:files] open is only available in the desktop app")
    },
    saveFileAs: async (path) => {
      if (isTauri()) {
        await native.saveFileAs(path)
        return
      }
      console.warn("[opal:files] save-as is only available in the desktop app")
    },

    useSessionDiff,
    listRepos: () => withBoot(api.listRepos),
    pickDirectory: async () => {
      if (!isTauri()) return window.prompt("Repository folder (absolute path)") ?? undefined
      return (await native.pickDirectory()) ?? undefined
    },
    createWorktree: (repo, base, branch) => withBoot(() => api.createWorktree(repo, base, branch)),

    useSettings: () => {
      useBooted()
      return useSettings()
    },
    updateSettings: async (patch: Partial<AppSettings>) => {
      boot()
      const before = settingsStore.getState().settings
      const next = await updateSettings(patch)
      const sandboxChanged = JSON.stringify(before.sandbox) !== JSON.stringify(next.sandbox)
      if (sandboxChanged) await configureSandbox(next.sandbox)
      if (JSON.stringify(before.remote) !== JSON.stringify(next.remote)) await syncRemote(next.remote)
      // Settings that feed opencode.json (default model/mode, sandbox on/off → `shell`, the vision agent) are
      // re-applied.
      const shellToggled = sandboxChanged && (before.sandbox.mode === "off") !== (next.sandbox.mode === "off")
      if (
        before.defaultModel !== next.defaultModel ||
        before.defaultMode !== next.defaultMode ||
        shellToggled ||
        JSON.stringify(before.imageFallback) !== JSON.stringify(next.imageFallback)
      )
        await applyConfig()
    },
    saveProvider: (provider) => withBoot(() => saveProvider(provider)),
    deleteProvider: (id) => withBoot(() => deleteProvider(id)),
    testProvider: (provider, modelID) => withBoot(() => testProvider(provider, modelID)),
    importOpenCodeConfig: () => withBoot(importOpenCodeConfig),
    saveProject: (project) => withBoot(() => saveProject(project)),
    deleteProject: (id) => withBoot(() => deleteProject(id)),
    addProjectKnowledge: (id, files) => withBoot(() => addProjectKnowledge(id, files)),
    getPrompt: (mode) => withBoot(() => getPrompt(mode)),
    setPromptOverride: (mode, text) => withBoot(() => setPromptOverride(mode, text)),
  }
}
