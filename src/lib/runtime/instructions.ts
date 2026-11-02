/**
 * Per-session instruction entries (`experimental.session.instructions.entry.put`).
 * String values are rendered verbatim to the model inside `<context key="…">` blocks
 * (core/session/instruction-entry.ts); each value must stay under 256 KB.
 */
import type { Project } from "./contracts"

export const SANDBOX_KEY = "opal-sandbox"
export const PROJECT_KEY = "opal-project"
const MAX_BYTES = 250 * 1024

export function sandboxInstructions(directory: string): string {
  return [
    "This conversation has its own private working folder on the user's Mac:",
    directory,
    "",
    "- It is your current working directory. You may freely read, create, edit and run things inside it.",
    "- Files the user attaches are copied into `uploads/` (for example `uploads/report.pdf`). Treat them as inputs; do not modify them in place.",
    "- Save files you produce (reports, data, code, images, exports) in the folder root or a sub-folder. The user sees them in the Files panel and can open, reveal or save them.",
    "- For visual or interactive deliverables (web pages, apps, charts, diagrams, rich documents meant to be viewed) prefer an artifact (the artifact tools) so it opens in the preview panel; use plain files for downloadable outputs.",
    "- Do not read or change anything outside this folder unless the user explicitly asks you to.",
  ].join("\n")
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** @param knowledgePaths display paths of the knowledge files (relative to the working folder when copied). */
export function projectInstructions(
  project: Project,
  knowledgePaths: { path: string; size: number }[],
): string {
  const lines = [`This conversation belongs to the project "${project.name}".`]
  if (project.description?.trim()) lines.push("", project.description.trim())
  if (project.instructions?.trim())
    lines.push(
      "",
      "Project instructions (follow them throughout the conversation):",
      project.instructions.trim(),
    )
  if (knowledgePaths.length) {
    lines.push("", "Project knowledge files (read them when they are relevant to the request):")
    for (const file of knowledgePaths) lines.push(`- ${file.path} (${formatSize(file.size)})`)
  }
  const text = lines.join("\n")
  const bytes = new TextEncoder().encode(text)
  return bytes.length <= MAX_BYTES
    ? text
    : new TextDecoder().decode(bytes.slice(0, MAX_BYTES)) + "\n…(truncated)"
}
