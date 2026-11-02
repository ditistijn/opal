/**
 * Update state shared by Settings → About, the "Check for Updates…" menu item and the update banner.
 * Owner: macOS/packaging. Talks to the updater only through ./updates (plain data in, plain data out).
 *
 * Nothing here ever installs on its own: `install()` runs only from an explicit click.
 */
import { create } from "zustand"
import { checkForUpdates, installUpdate, type UpdateInfo } from "./updates"

export type UpdateStatus = "idle" | "checking" | "none" | "available" | "downloading" | "installing" | "error"

export interface UpdateState {
  status: UpdateStatus
  /** Download progress 0–1 (0 while the size is unknown). */
  progress: number
  /** The update found by the last successful check. */
  available?: UpdateInfo
  /** Last error message (status "error"). */
  error?: string
  /** Epoch ms of the last completed check (successful or not). */
  lastChecked?: number
  /** Version whose banner the user hid with "Later" (for this app session only). */
  dismissedVersion?: string
  /**
   * Check for an update. `silent` (launch / periodic checks) never shows "Checking…" and swallows
   * errors so a flaky network never puts a red message in front of the user.
   */
  check(options?: { silent?: boolean }): Promise<void>
  /** Download + install the available update, then relaunch. */
  install(): Promise<void>
  /** "Later": hide the banner for the available version until the app restarts. */
  dismiss(): void
}

let inflight: Promise<void> | undefined

export const useUpdates = create<UpdateState>((set, get) => ({
  status: "idle",
  progress: 0,

  check({ silent = false } = {}) {
    const { status } = get()
    if (status === "downloading" || status === "installing") return Promise.resolve()
    if (inflight) {
      // A silent check is already running and the user asked explicitly: show that it is in progress.
      if (!silent) set({ status: "checking", error: undefined })
      return inflight
    }
    const previous = get().status
    if (!silent) set({ status: "checking", error: undefined })
    inflight = (async () => {
      try {
        const result = await checkForUpdates()
        const lastChecked = Date.now()
        if (result.state === "available") {
          const { state: _state, ...info } = result
          set({ status: "available", available: info, error: undefined, lastChecked })
        } else if (result.state === "none") {
          set({ status: "none", available: undefined, error: undefined, lastChecked })
        } else if (silent && get().status !== "checking") {
          console.warn("[opal:updates] background check failed:", result.message)
          set({ status: previous === "checking" ? "idle" : previous, lastChecked })
        } else {
          set({ status: "error", error: result.message, lastChecked })
        }
      } finally {
        inflight = undefined
      }
    })()
    return inflight
  },

  async install() {
    const { available, status } = get()
    if (!available || status === "downloading" || status === "installing") return
    set({ status: "downloading", progress: 0, error: undefined })
    try {
      await installUpdate(available, (fraction, phase) => {
        set({ status: phase, progress: fraction ?? 0 })
      })
    } catch (error) {
      set({
        status: "error",
        progress: 0,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  dismiss() {
    set((s) => ({ dismissedVersion: s.available?.version }))
  },
}))

/** A short plain-text excerpt of release notes (markdown markers stripped), or undefined. */
export function notesExcerpt(notes: string | undefined, max = 240): string | undefined {
  if (!notes) return undefined
  const text = notes
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s*|\d+\.\s+)/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/[*_`]/g, "")
  if (!text) return undefined
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** Whether the bottom-of-window banner should show for the current state. */
export function shouldShowBanner(state: Pick<UpdateState, "status" | "available" | "dismissedVersion">) {
  if (!state.available) return false
  if (state.status !== "available" && state.status !== "downloading" && state.status !== "installing")
    return false
  return state.dismissedVersion !== state.available.version
}

export const AUTO_CHECK_DELAY_MS = 8_000
export const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Silent check ~8 s after start, then every 6 h. Returns a disposer. */
export function startAutoUpdateChecks(): () => void {
  const run = () => void useUpdates.getState().check({ silent: true })
  let interval: ReturnType<typeof setInterval> | undefined
  const timeout = setTimeout(() => {
    run()
    interval = setInterval(run, AUTO_CHECK_INTERVAL_MS)
  }, AUTO_CHECK_DELAY_MS)
  return () => {
    clearTimeout(timeout)
    if (interval) clearInterval(interval)
  }
}
