/** Creates a Code session — optionally in a fresh isolated worktree — and opens it. */
import type { ModelRef, SessionInfo } from "@/lib/opencode/types"
import { runtime, type ModeID, type PromptInput } from "@/lib/runtime"
import { useCodeNav } from "./code-nav"
import { slugify } from "./format"

export interface StartSessionInput {
  repoDirectory: string
  worktree: boolean
  /** Branch/ref the worktree starts from (default: the repo's HEAD). */
  baseBranch?: string
  /** New branch for the worktree (default: opal/<title-or-repo>-<id>). */
  branch?: string
  title?: string
  mode?: ModeID
  model?: ModelRef
  /** Sent as the first prompt once the session exists. */
  prompt?: PromptInput
}

export function branchFromTitle(title: string | undefined) {
  const t = title?.trim()
  return t ? `opal/${slugify(t)}` : undefined
}

export async function startSession(input: StartSessionInput): Promise<SessionInfo> {
  const title = input.title?.trim() || undefined
  const mode = input.mode ?? "code"
  let session: SessionInfo
  if (input.worktree) {
    const wt = await runtime.createWorktree(
      input.repoDirectory,
      input.baseBranch || undefined,
      input.branch?.trim() || branchFromTitle(title),
    )
    session = await runtime.createSession({
      surface: "code",
      directory: wt.directory,
      repoDirectory: input.repoDirectory,
      worktreeBranch: wt.branch,
      mode,
      model: input.model,
      title,
    })
  } else {
    session = await runtime.createSession({
      surface: "code",
      directory: input.repoDirectory,
      mode,
      model: input.model,
      title,
    })
  }
  useCodeNav.getState().openSession(session.id)
  useCodeNav.getState().setHomeRepo(input.repoDirectory)
  if (input.prompt && (input.prompt.text || input.prompt.files?.length))
    await runtime.sendPrompt(session.id, input.prompt)
  return session
}
