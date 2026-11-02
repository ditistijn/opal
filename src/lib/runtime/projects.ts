/** Projects: settings-backed CRUD + knowledge files under projects/<id>/knowledge/. */
import { isTauri } from "@/lib/utils"
import type { DroppedFile, Project } from "./contracts"
import { inlinePayload, native } from "./native"
import { updateSettings } from "./stores/settings"

export async function saveProject(project: Project) {
  const now = Date.now()
  await updateSettings((s) => {
    const exists = s.projects.some((p) => p.id === project.id)
    const next = { ...project, created: project.created || now, updated: now }
    return {
      ...s,
      projects: exists ? s.projects.map((p) => (p.id === project.id ? next : p)) : [...s.projects, next],
    }
  })
}

export async function deleteProject(projectID: string) {
  // Knowledge files on disk are kept (conversations may reference copies of them).
  await updateSettings((s) => ({ ...s, projects: s.projects.filter((p) => p.id !== projectID) }))
}

export async function addProjectKnowledge(projectID: string, files: DroppedFile[]) {
  if (!files.length) return
  // LIMITATION: the plain-browser build cannot store knowledge files on disk.
  if (!isTauri()) throw new Error("Adding project knowledge requires the desktop app")
  const byPath = files.filter((f) => f.path)
  const byBytes = files.filter((f) => !f.path && f.bytes) as (DroppedFile & { bytes: Uint8Array })[]
  const entries = await native.importProjectKnowledge(
    projectID,
    byPath.map((f) => f.path!),
    inlinePayload(byBytes.map((f) => ({ name: f.name, bytes: f.bytes }))),
  )
  const added = Date.now()
  await updateSettings((s) => ({
    ...s,
    projects: s.projects.map((p) =>
      p.id === projectID
        ? {
            ...p,
            knowledge: [
              ...p.knowledge,
              ...entries.map((e) => ({ name: e.name, path: e.path, size: e.size, added })),
            ],
            updated: added,
          }
        : p,
    ),
  }))
}
