/**
 * Shared helpers for chat UI tests. Each test file mocks "@/lib/runtime" with the in-memory
 * mock runtime (vi.mock must live in the test file itself, so only helpers live here).
 */
import { useDrafts } from "@/features/composer/drafts"
import { useNav } from "@/features/chat/nav-store"
import type { MockRuntime } from "@/lib/runtime/mock"
import { runtime } from "@/lib/runtime"

export const mock = runtime as unknown as MockRuntime

export function resetUI() {
  useDrafts.setState({ text: {}, files: {} })
  useNav.setState({ view: { kind: "home" }, searchOpen: false, settings: { open: false }, narrowTab: "chat" })
  localStorage.clear()
}

// jsdom lacks these; components guard most, but Radix and layout code touch them.
if (typeof window !== "undefined") {
  window.HTMLElement.prototype.scrollIntoView ??= function () {}
  window.HTMLElement.prototype.hasPointerCapture ??= () => false
  window.HTMLElement.prototype.releasePointerCapture ??= function () {}
  window.matchMedia ??= ((q: string) =>
    ({
      matches: false,
      media: q,
      addEventListener() {},
      removeEventListener() {},
      onchange: null,
    }) as unknown as MediaQueryList) as typeof window.matchMedia
}
