import { runtime } from "@/lib/runtime"
import { ArtifactPanelView } from "./ArtifactPanelView"

/**
 * Artifact panel for a chat session: preview (sandboxed artifact:// iframe) / code,
 * versions, export, fullscreen. Mounted by the chat UI in the split layout (and as a tab when narrow).
 * Shows the session's active artifact (runtime.useActiveArtifact); closing clears it.
 */
export function ArtifactPanel({ sessionID }: { sessionID: string }) {
  return <ArtifactPanelView sessionID={sessionID} rt={runtime} />
}

export default ArtifactPanel
