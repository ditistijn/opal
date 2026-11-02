/**
 * Side-effecting export actions. Tauri: native save dialog / temp file + default browser via Rust
 * commands in src-tauri/src/versions.rs. Plain browser: Blob downloads and window.open.
 */
import { isTauri } from "@/lib/utils"
import { isOpenableURL } from "./url"

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core")
  return core.invoke<T>(cmd, args)
}

/** Saves bytes under a user-chosen path. Resolves to the saved path, or undefined when cancelled/browser. */
export async function saveBytes(
  fileName: string,
  data: Uint8Array | string,
  mime: string,
): Promise<string | undefined> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data
  if (isTauri()) {
    const path = await invoke<string | null>("cmd_save_artifact_export", {
      fileName,
      data: Array.from(bytes),
    })
    return path ?? undefined
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return undefined
}

/** Opens a standalone HTML export in the user's default browser. */
export async function openInBrowser(artifactID: string, html: string): Promise<void> {
  if (isTauri()) {
    await invoke<string>("cmd_open_artifact_export", { artifactId: artifactID, html })
    return
  }
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }))
  window.open(url, "_blank", "noopener")
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Opens an http(s)/mailto link requested by an artifact (opal:open-url). Other schemes are ignored. */
export async function openExternalURL(url: string): Promise<void> {
  if (!isOpenableURL(url)) return
  if (isTauri()) {
    const opener = await import("@tauri-apps/plugin-opener")
    await opener.openUrl(url)
    return
  }
  window.open(url, "_blank", "noopener,noreferrer")
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}
