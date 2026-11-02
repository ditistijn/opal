import { useEffect, useState } from "react"
import type { ArtifactContent } from "@/lib/opencode/types"
import { readVersionFiles } from "@/lib/artifacts/versions"
import type { ArtifactRuntime } from "./types"

/** The app theme as applied on <html data-theme> (kept in sync with a MutationObserver). */
export function useDocumentTheme(): "light" | "dark" {
  const read = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light")
  const [theme, setTheme] = useState<"light" | "dark">(read)
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(read()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
    return () => obs.disconnect()
  }, [])
  return theme
}

export type ContentState =
  | { status: "idle" | "loading" }
  | { status: "ready"; content: ArtifactContent }
  | { status: "error"; error: string }

/**
 * Loads an artifact's files (live, or snapshot `version`) and reloads whenever `updated` changes.
 * Previous content stays visible while a reload is in flight.
 */
export function useArtifactContent(
  rt: Pick<ArtifactRuntime, "getArtifactContent">,
  artifactID: string | undefined,
  updated: number | undefined,
  version?: number,
): ContentState {
  const [state, setState] = useState<ContentState>({ status: "idle" })
  useEffect(() => {
    if (!artifactID) {
      setState({ status: "idle" })
      return
    }
    let cancelled = false
    setState((s) => (s.status === "ready" && s.content.info.id === artifactID ? s : { status: "loading" }))
    const load = async (): Promise<ArtifactContent> => {
      const live = await rt.getArtifactContent(artifactID)
      if (version === undefined) return live
      return { info: live.info, files: await readVersionFiles(artifactID, version) }
    }
    load().then(
      (content) => !cancelled && setState({ status: "ready", content }),
      (err: unknown) =>
        !cancelled && setState({ status: "error", error: err instanceof Error ? err.message : String(err) }),
    )
    return () => {
      cancelled = true
    }
  }, [rt, artifactID, updated, version])
  return state
}

/** `true` for `ms` after `flash()` is called (copy confirmations). */
export function useFlash(ms = 1500): [boolean, () => void] {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!on) return
    const t = window.setTimeout(() => setOn(false), ms)
    return () => window.clearTimeout(t)
  }, [on, ms])
  return [on, () => setOn(true)]
}
