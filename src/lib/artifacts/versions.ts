import { isTauri } from "@/lib/utils"

/** Files of an immutable version snapshot (src-tauri/src/versions.rs cmd_read_artifact_version). */
export async function readVersionFiles(artifactID: string, n: number): Promise<Record<string, string>> {
  if (!isTauri()) throw new Error("Version snapshots are only available in the desktop app")
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<Record<string, string>>("cmd_read_artifact_version", { artifactId: artifactID, n })
}
