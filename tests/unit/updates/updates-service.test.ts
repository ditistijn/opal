import { afterEach, describe, expect, it, vi } from "vitest"

const check = vi.fn()
const relaunch = vi.fn()
const getVersion = vi.fn(async () => "0.1.5")
vi.mock("@tauri-apps/plugin-updater", () => ({ check }))
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }))
vi.mock("@tauri-apps/api/app", () => ({ getVersion }))

import {
  PACKAGE_VERSION,
  UPDATES_DESKTOP_ONLY,
  checkForUpdates,
  getAppVersion,
  installUpdate,
} from "@/lib/native/updates"

const tauri = () => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {})

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  check.mockReset()
  relaunch.mockReset()
})

describe("updates service", () => {
  it("explains that updates are desktop-only in the browser", async () => {
    expect(await checkForUpdates()).toEqual({ state: "error", message: UPDATES_DESKTOP_ONLY })
    await expect(installUpdate({ version: "1.0.0" })).rejects.toThrow(UPDATES_DESKTOP_ONLY)
    expect(await getAppVersion()).toBe(PACKAGE_VERSION)
    expect(check).not.toHaveBeenCalled()
  })

  it("reads the bundle version in Tauri", async () => {
    tauri()
    expect(await getAppVersion()).toBe("0.1.5")
  })

  it("maps check results to plain data", async () => {
    tauri()
    check.mockResolvedValueOnce(null)
    expect(await checkForUpdates()).toEqual({ state: "none" })
    check.mockRejectedValueOnce(new Error("network down"))
    expect(await checkForUpdates()).toEqual({ state: "error", message: "network down" })
  })

  it("downloads with progress, installs, then relaunches", async () => {
    tauri()
    const update = {
      version: "0.2.0",
      body: "  Notes  ",
      date: "2026-11-01T00:00:00Z",
      close: vi.fn(async () => {}),
      download: vi.fn(async (cb: (e: unknown) => void) => {
        cb({ event: "Started", data: { contentLength: 100 } })
        cb({ event: "Progress", data: { chunkLength: 40 } })
        cb({ event: "Progress", data: { chunkLength: 60 } })
        cb({ event: "Finished" })
      }),
      install: vi.fn(async () => {}),
    }
    check.mockResolvedValueOnce(update)
    expect(await checkForUpdates()).toEqual({
      state: "available",
      version: "0.2.0",
      notes: "Notes",
      date: "2026-11-01T00:00:00Z",
    })
    const progress = vi.fn()
    await installUpdate({ version: "0.2.0" }, progress)
    expect(progress).toHaveBeenCalledWith(0.4, "downloading")
    expect(progress).toHaveBeenLastCalledWith(1, "installing")
    expect(update.install).toHaveBeenCalled()
    expect(relaunch).toHaveBeenCalled()
    await expect(installUpdate({ version: "0.2.0" })).rejects.toThrow(/no longer available/)
  })
})
