import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { checkForUpdates, installUpdate } = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
  installUpdate: vi.fn(),
}))
vi.mock("@/lib/native/updates", () => ({ checkForUpdates, installUpdate }))

import {
  AUTO_CHECK_DELAY_MS,
  AUTO_CHECK_INTERVAL_MS,
  notesExcerpt,
  shouldShowBanner,
  startAutoUpdateChecks,
  useUpdates,
} from "@/lib/native/update-store"

const initial = useUpdates.getState()

beforeEach(() => {
  useUpdates.setState(
    {
      ...initial,
      status: "idle",
      progress: 0,
      available: undefined,
      error: undefined,
      lastChecked: undefined,
      dismissedVersion: undefined,
    },
    true,
  )
  checkForUpdates.mockReset()
  installUpdate.mockReset()
})

describe("update store", () => {
  it("goes checking → available and records the release", async () => {
    let resolve!: (v: unknown) => void
    checkForUpdates.mockReturnValue(new Promise((r) => (resolve = r)))
    const done = useUpdates.getState().check()
    expect(useUpdates.getState().status).toBe("checking")
    resolve({ state: "available", version: "0.2.0", notes: "Faster", date: "2026-11-01T00:00:00Z" })
    await done
    const s = useUpdates.getState()
    expect(s.status).toBe("available")
    expect(s.available).toEqual({ version: "0.2.0", notes: "Faster", date: "2026-11-01T00:00:00Z" })
    expect(s.lastChecked).toBeTypeOf("number")
  })

  it("goes checking → none when up to date", async () => {
    checkForUpdates.mockResolvedValue({ state: "none" })
    await useUpdates.getState().check()
    expect(useUpdates.getState().status).toBe("none")
    expect(useUpdates.getState().available).toBeUndefined()
  })

  it("shows errors from explicit checks", async () => {
    checkForUpdates.mockResolvedValue({ state: "error", message: "offline" })
    await useUpdates.getState().check({ silent: false })
    expect(useUpdates.getState()).toMatchObject({ status: "error", error: "offline" })
  })

  it("silent checks never show checking or errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    let resolve!: (v: unknown) => void
    checkForUpdates.mockReturnValue(new Promise((r) => (resolve = r)))
    const done = useUpdates.getState().check({ silent: true })
    expect(useUpdates.getState().status).toBe("idle")
    resolve({ state: "error", message: "offline" })
    await done
    expect(useUpdates.getState().status).toBe("idle")
    expect(useUpdates.getState().error).toBeUndefined()
    warn.mockRestore()
  })

  it("dedupes concurrent checks", async () => {
    checkForUpdates.mockResolvedValue({ state: "none" })
    await Promise.all([useUpdates.getState().check({ silent: true }), useUpdates.getState().check()])
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it("installs with progress: downloading → installing", async () => {
    useUpdates.setState({ status: "available", available: { version: "0.2.0" } })
    const seen: Array<[string, number]> = []
    const unsub = useUpdates.subscribe((s) => seen.push([s.status, s.progress]))
    installUpdate.mockImplementation(async (_info, onProgress) => {
      onProgress(0, "downloading")
      onProgress(0.5, "downloading")
      onProgress(1, "installing")
    })
    await useUpdates.getState().install()
    unsub()
    expect(installUpdate).toHaveBeenCalledWith({ version: "0.2.0" }, expect.any(Function))
    expect(seen).toContainEqual(["downloading", 0.5])
    expect(useUpdates.getState().status).toBe("installing")
  })

  it("reports install failures", async () => {
    useUpdates.setState({ status: "available", available: { version: "0.2.0" } })
    installUpdate.mockRejectedValue(new Error("signature mismatch"))
    await useUpdates.getState().install()
    expect(useUpdates.getState()).toMatchObject({ status: "error", error: "signature mismatch", progress: 0 })
  })

  it("does nothing on install without an available update", async () => {
    await useUpdates.getState().install()
    expect(installUpdate).not.toHaveBeenCalled()
  })

  it("dismiss hides the banner for that version only", () => {
    useUpdates.setState({ status: "available", available: { version: "0.2.0" } })
    expect(shouldShowBanner(useUpdates.getState())).toBe(true)
    useUpdates.getState().dismiss()
    expect(shouldShowBanner(useUpdates.getState())).toBe(false)
    useUpdates.setState({ available: { version: "0.3.0" } })
    expect(shouldShowBanner(useUpdates.getState())).toBe(true)
    useUpdates.setState({ status: "error" })
    expect(shouldShowBanner(useUpdates.getState())).toBe(false)
  })
})

describe("startAutoUpdateChecks", () => {
  afterEach(() => vi.useRealTimers())

  it("runs a silent check after the delay and then on the interval", async () => {
    vi.useFakeTimers()
    checkForUpdates.mockResolvedValue({ state: "none" })
    const stop = startAutoUpdateChecks()
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_DELAY_MS - 1)
    expect(checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS)
    expect(checkForUpdates).toHaveBeenCalledTimes(2)
    stop()
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS * 2)
    expect(checkForUpdates).toHaveBeenCalledTimes(2)
  })
})

describe("notesExcerpt", () => {
  it("strips markdown markers and truncates", () => {
    expect(notesExcerpt(undefined)).toBeUndefined()
    expect(notesExcerpt("## What's new\n\n- **Faster** startup\n- Fixes")).toBe(
      "What's new Faster startup Fixes",
    )
    const long = notesExcerpt("x".repeat(500), 20)!
    expect(long).toHaveLength(20)
    expect(long.endsWith("…")).toBe(true)
  })
})
