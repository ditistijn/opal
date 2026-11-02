/**
 * Over-the-air updates via the Tauri updater plugin (GitHub Releases, see docs/UPDATES.md).
 * Owner: macOS/packaging.
 *
 * The plugin's `Update` object holds a Rust-side resource; it stays in a module-level map keyed by
 * version so callers (the update store, the UI) only ever pass plain `UpdateInfo` data around.
 * Signature verification against the public key in tauri.conf.json happens in Rust before install.
 */
import { version as PACKAGE_VERSION } from "../../../package.json"
import { isTauri } from "@/lib/utils"
import type { Update } from "@tauri-apps/plugin-updater"

/** Shown (and returned) when the app runs in a plain browser, where the updater does not exist. */
export const UPDATES_DESKTOP_ONLY = "Updates are only available in the desktop app."

export interface UpdateInfo {
  /** The version announced by latest.json, e.g. "0.2.0". */
  version: string
  /** Release notes (latest.json `notes`). */
  notes?: string
  /** Publish date (latest.json `pub_date`, RFC 3339). */
  date?: string
}

export type UpdateCheckResult =
  { state: "none" } | ({ state: "available" } & UpdateInfo) | { state: "error"; message: string }

/** Pending updates from the last check(s), keyed by version. */
const pending = new Map<string, Update>()

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Something went wrong while checking for updates."
}

/** The running app's version: Tauri's bundle version, or package.json's in the browser. */
export async function getAppVersion(): Promise<string> {
  if (!isTauri()) return PACKAGE_VERSION
  try {
    const { getVersion } = await import("@tauri-apps/api/app")
    return await getVersion()
  } catch {
    return PACKAGE_VERSION
  }
}

export { PACKAGE_VERSION }

/** Asks the configured endpoint (latest.json) whether a newer, signed release exists. */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (!isTauri()) return { state: "error", message: UPDATES_DESKTOP_ONLY }
  try {
    const { check } = await import("@tauri-apps/plugin-updater")
    const update = await check({ timeout: 30_000 })
    // Release resources from older checks; only the newest announced update is kept.
    for (const [version, stale] of pending) {
      if (update && version === update.version) continue
      pending.delete(version)
      void stale.close().catch(() => {})
    }
    if (!update) return { state: "none" }
    pending.set(update.version, update)
    return {
      state: "available",
      version: update.version,
      notes: update.body?.trim() || undefined,
      date: update.date || undefined,
    }
  } catch (error) {
    return { state: "error", message: errorMessage(error) }
  }
}

/**
 * Downloads and installs a previously checked update, then relaunches Opal.
 * `onProgress` receives 0–1 while the size is known (undefined when the server sends no length).
 * Resolves only if relaunching fails to replace the process; rejects on download/verify/install errors.
 */
export async function installUpdate(
  info: Pick<UpdateInfo, "version">,
  onProgress?: (fraction: number | undefined, phase: "downloading" | "installing") => void,
): Promise<void> {
  if (!isTauri()) throw new Error(UPDATES_DESKTOP_ONLY)
  const update = pending.get(info.version)
  if (!update) throw new Error(`Opal ${info.version} is no longer available. Check for updates again.`)

  let total: number | undefined
  let received = 0
  await update.download((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength || undefined
      onProgress?.(total ? 0 : undefined, "downloading")
    } else if (event.event === "Progress") {
      received += event.data.chunkLength
      onProgress?.(total ? Math.min(1, received / total) : undefined, "downloading")
    } else {
      onProgress?.(1, "downloading")
    }
  })
  onProgress?.(1, "installing")
  await update.install()
  pending.delete(info.version)
  const { relaunch } = await import("@tauri-apps/plugin-process")
  await relaunch()
}
