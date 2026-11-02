/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Connect to an external OpenCode server instead of the Tauri sidecar (browser dev / e2e). */
  readonly VITE_OPENCODE_URL?: string
  readonly VITE_OPENCODE_PASSWORD?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
