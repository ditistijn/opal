/**
 * Typed subscription to the native macOS menu (src-tauri/src/menu.rs). Owner: macOS/packaging.
 *
 * Menu key equivalents (⌘N, ⌘,, ⌘⇧A …) are handled by AppKit before the webview sees them, so inside
 * Tauri these shortcuts arrive as events, not keydowns. Keep keydown handlers for the browser build and
 * skip them when `isTauri()` to avoid double-firing. Event list: docs/SETUP.md → "Menu events".
 */
import { isTauri } from "@/lib/utils"
import type { Surface } from "@/lib/runtime/contracts"

export interface MenuEventPayloads {
  "menu:check-updates": null
  "menu:settings": null
  "menu:new-chat": null
  "menu:new-project": null
  "menu:toggle-sidebar": null
  "menu:toggle-artifact-panel": null
  "menu:surface": Surface
}

export type MenuEventName = keyof MenuEventPayloads
export type MenuHandlers = { [K in MenuEventName]?: (payload: MenuEventPayloads[K]) => void }

export const MENU_EVENTS = [
  "menu:check-updates",
  "menu:settings",
  "menu:new-chat",
  "menu:new-project",
  "menu:toggle-sidebar",
  "menu:toggle-artifact-panel",
  "menu:surface",
] as const satisfies readonly MenuEventName[]

/**
 * Subscribe to native menu events. Returns an unsubscribe function; a no-op outside Tauri.
 *
 *   useEffect(() => onMenuEvents({ "menu:new-chat": () => newChat(), "menu:surface": setSurface }), [])
 */
export function onMenuEvents(handlers: MenuHandlers): () => void {
  if (!isTauri()) return () => {}
  let disposed = false
  const unlisteners: Array<() => void> = []
  void import("@tauri-apps/api/event").then(({ listen }) => {
    for (const name of MENU_EVENTS) {
      const handler = handlers[name] as ((payload: unknown) => void) | undefined
      if (!handler) continue
      void listen(name, (event) => handler(event.payload)).then((un) => {
        if (disposed) un()
        else unlisteners.push(un)
      })
    }
  })
  return () => {
    disposed = true
    for (const un of unlisteners.splice(0)) un()
  }
}
