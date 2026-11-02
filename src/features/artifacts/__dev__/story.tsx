/**
 * Dev-only story for the artifact panel: http://localhost:1420/src/features/artifacts/__dev__/story.html
 *   ?artifact=art_react  &mode=code  &theme=dark  &width=640
 * Uses an in-memory stub of the runtime slice the panel needs (no OpenCode server).
 */
import "@/index.css"
import { StrictMode, useMemo, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import type { ArtifactContent, ArtifactInfo } from "@/lib/opencode/types"
import type { ArtifactView } from "@/lib/runtime/contracts"
import { detectKind, previewURL } from "@/lib/artifacts"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ArtifactPanelView } from "../ArtifactPanelView"
import type { ArtifactRuntime } from "../types"
import { SAMPLE_ARTIFACTS } from "./samples"

const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light"

const now = Date.now()
type State = { artifacts: Record<string, ArtifactContent>; active?: string; prompts: string[] }
let state: State = {
  artifacts: Object.fromEntries(
    SAMPLE_ARTIFACTS.map((a, i) => [
      a.id,
      {
        info: {
          id: a.id,
          title: a.title,
          entry: a.entry,
          provider: "local",
          sessionID: "ses_story",
          url: "",
          time: { created: now - (i + 1) * 3_600_000, updated: now - i * 120_000 },
        } as unknown as ArtifactInfo,
        files: a.files,
      },
    ]),
  ),
  active: params.get("artifact") ?? "art_react",
  prompts: [],
}
const listeners = new Set<() => void>()
const set = (fn: (s: State) => State) => {
  state = fn(state)
  listeners.forEach((l) => l())
}
const useStore = <T,>(sel: (s: State) => T) =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => sel(state),
  )

const rt: ArtifactRuntime = {
  useArtifacts: () => {
    const a = useStore((s) => s.artifacts)
    return useMemo(() => Object.values(a).map((c) => c.info), [a])
  },
  useArtifact: (id) => {
    const a = useStore((s) => (id ? s.artifacts[id] : undefined))
    return useMemo((): ArtifactView | undefined => {
      if (!a) return undefined
      const kind = detectKind(a.info.entry, a.files)
      return {
        info: a.info,
        kind,
        previewURL: previewURL(a.info, kind, { transport: "bridge" }),
        versions: [
          { n: 1, time: a.info.time.created, path: "", title: a.info.title },
          { n: 2, time: a.info.time.updated, path: "", title: a.info.title },
        ],
      }
    }, [a])
  },
  useActiveArtifact: () => ({
    artifactID: useStore((s) => s.active),
    setActive: (id) => set((s) => ({ ...s, active: id })),
  }),
  getArtifactContent: async (id) => {
    const a = state.artifacts[id]
    if (!a) throw new Error(`no artifact ${id}`)
    return a
  },
  updateArtifact: async (id, files, title) =>
    set((s) => {
      const a = s.artifacts[id]
      const info = { ...a.info, title: title ?? a.info.title, time: { ...a.info.time, updated: Date.now() } }
      return { ...s, artifacts: { ...s.artifacts, [id]: { info, files } } }
    }),
  restoreArtifactVersion: async () => {},
  sendPrompt: async (_sessionID, input) => {
    set((s) => ({ ...s, prompts: [...s.prompts, input.text] }))
    ;(window as unknown as { __prompts: string[] }).__prompts = state.prompts
  },
}

function Story() {
  const width = Number(params.get("width")) || undefined
  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full bg-bg">
        <div className="flex-1 border-r border-border p-6 text-sm text-fg-muted">Chat column</div>
        <div style={{ width: width ?? "58%" }} className="flex min-w-0 flex-col">
          <ArtifactPanelView sessionID="ses_story" rt={rt} />
        </div>
      </div>
    </TooltipProvider>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Story />
  </StrictMode>,
)
