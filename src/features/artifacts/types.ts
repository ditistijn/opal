import type { Runtime } from "@/lib/runtime/contracts"

/** The slice of the runtime the artifact panel uses (lets the dev story inject a stub). */
export type ArtifactRuntime = Pick<
  Runtime,
  | "useArtifacts"
  | "useArtifact"
  | "useActiveArtifact"
  | "getArtifactContent"
  | "updateArtifact"
  | "restoreArtifactVersion"
  | "sendPrompt"
>
