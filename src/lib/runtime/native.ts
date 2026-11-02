/**
 * Typed wrappers around the Rust commands registered in src-tauri/src/lib.rs.
 * Callers must check `isTauri()` first (these throw in the plain browser).
 * Tauri maps snake_case Rust parameters to camelCase keys.
 */
import type { ArtifactVersion, RemoteStatus, SandboxMode, SandboxStatus } from "./contracts"

export interface NativeFileEntry {
  path: string
  name: string
  size: number
  modified: number
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(cmd, args)
}

/** `[name, bytes]` pairs as serde expects them for `Vec<(String, Vec<u8>)>`. */
export function inlinePayload(files: { name: string; bytes: Uint8Array }[]): [string, number[]][] {
  return files.map((f) => [f.name, Array.from(f.bytes)])
}

export const native = {
  createConversationDir: (sessionId: string) => call<string>("cmd_create_conversation_dir", { sessionId }),
  importUploads: (
    sessionId: string,
    paths: string[],
    inline: [string, number[]][],
    subdir: "uploads" | "knowledge" = "uploads",
  ) => call<NativeFileEntry[]>("cmd_import_uploads", { sessionId, paths, inline, subdir }),
  listSessionFiles: (directory: string) => call<NativeFileEntry[]>("cmd_list_session_files", { directory }),
  revealPath: (path: string) => call<void>("cmd_reveal_path", { path }),
  openPath: (path: string) => call<void>("cmd_open_path", { path }),
  saveFileAs: (path: string) => call<string | null>("cmd_save_file_as", { path }),
  pickDirectory: () => call<string | null>("cmd_pick_directory"),
  importProjectKnowledge: (projectId: string, paths: string[], inline: [string, number[]][]) =>
    call<NativeFileEntry[]>("cmd_import_project_knowledge", { projectId, paths, inline }),
  deleteConversationDir: (sessionId: string) => call<void>("cmd_delete_conversation_dir", { sessionId }),
  readOpencodeConfig: () => call<Record<string, unknown>>("cmd_read_opencode_config"),
  writeOpencodeConfig: (config: Record<string, unknown>) =>
    call<void>("cmd_write_opencode_config", { config }),
  readUserCliConfig: () => call<Record<string, unknown> | null>("cmd_read_user_cli_config"),
  readPrompt: (mode: string) => call<string>("cmd_read_prompt", { mode }),
  readSettings: () => call<Record<string, unknown> | null>("cmd_read_settings"),
  writeSettings: (settings: Record<string, unknown>) => call<void>("cmd_write_settings", { settings }),
  serverLogs: () => call<string[]>("cmd_server_logs"),
  // sandbox_exec.rs / remote_web.rs
  sandboxStatus: () => call<SandboxStatus>("cmd_sandbox_status"),
  sandboxConfigure: (mode: SandboxMode, allow: string[]) =>
    call<SandboxStatus>("cmd_sandbox_configure", { mode, allow }),
  remoteStatus: () => call<RemoteStatus>("cmd_remote_status"),
  remoteConfigure: (enabled: boolean, lan: boolean) =>
    call<RemoteStatus>("cmd_remote_configure", { enabled, lan }),
  remoteRevoke: () => call<RemoteStatus>("cmd_remote_revoke"),
  // versions.rs (owned by the artifacts feature)
  snapshotArtifact: (artifactId: string, title: string) =>
    call<ArtifactVersion>("cmd_snapshot_artifact", { artifactId, title }),
  listArtifactVersions: (artifactId: string) =>
    call<ArtifactVersion[]>("cmd_list_artifact_versions", { artifactId }),
  readArtifactVersion: (artifactId: string, n: number) =>
    call<Record<string, string>>("cmd_read_artifact_version", { artifactId, n }),
}
