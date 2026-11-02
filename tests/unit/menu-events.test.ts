import { afterEach, describe, expect, it, vi } from "vitest"

const listen = vi.fn()
vi.mock("@tauri-apps/api/event", () => ({ listen }))

import { MENU_EVENTS, onMenuEvents } from "@/lib/native/menu-events"

const flush = () => new Promise((r) => setTimeout(r, 0))

describe("onMenuEvents", () => {
  afterEach(() => {
    listen.mockReset()
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it("lists exactly the events menu.rs emits", () => {
    expect([...MENU_EVENTS].sort()).toEqual(
      [
        "menu:check-updates",
        "menu:new-chat",
        "menu:new-project",
        "menu:settings",
        "menu:surface",
        "menu:toggle-artifact-panel",
        "menu:toggle-sidebar",
      ].sort(),
    )
  })

  it("is a no-op outside Tauri", async () => {
    const off = onMenuEvents({ "menu:new-chat": () => {} })
    await flush()
    expect(listen).not.toHaveBeenCalled()
    off()
  })

  it("subscribes only to handled events, forwards payloads and unsubscribes", async () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    const unlisten = vi.fn()
    const callbacks = new Map<string, (e: { payload: unknown }) => void>()
    listen.mockImplementation(async (name: string, cb: (e: { payload: unknown }) => void) => {
      callbacks.set(name, cb)
      return unlisten
    })
    const onSurface = vi.fn()
    const off = onMenuEvents({ "menu:surface": onSurface, "menu:settings": () => {} })
    await flush()
    await flush()
    expect([...callbacks.keys()].sort()).toEqual(["menu:settings", "menu:surface"])
    callbacks.get("menu:surface")!({ payload: "code" })
    expect(onSurface).toHaveBeenCalledWith("code")
    off()
    expect(unlisten).toHaveBeenCalledTimes(2)
  })
})
