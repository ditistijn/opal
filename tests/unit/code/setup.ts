/**
 * Shared helpers for Code-surface UI tests. Each test file mocks "@/lib/runtime" with the in-memory mock
 * runtime and "@/lib/runtime/code" with the mock CodeRuntime (vi.mock must live in the test file).
 */
import { useCodeNav } from "@/features/code/code-nav"
import { useCodeStatus } from "@/features/code/code-status"
import { useTerminals } from "@/features/code/terminal-store"
import { useDrafts } from "@/features/composer/drafts"
import { runtime } from "@/lib/runtime"
import type { MockRuntime } from "@/lib/runtime/mock"
import { resetMockCode } from "@/lib/runtime/mock/code"

export const mock = runtime as unknown as MockRuntime
export const ACME = "/Users/demo/Developer/acme-api"
export const SITE = "/Users/demo/Developer/marketing-site"

export function resetCode() {
  localStorage.clear()
  resetMockCode()
  useDrafts.setState({ text: {}, files: {} })
  useCodeStatus.setState({ bySession: {} })
  useTerminals.setState({ tabs: {}, active: {} })
  useCodeNav.setState({
    sessionID: undefined,
    paneOpen: false,
    paneTab: "diff",
    collapsed: {},
    homeRepo: undefined,
    newSession: { open: false },
    worktrees: { open: false },
    openFile: undefined,
    subagentID: undefined,
  })
}

if (typeof window !== "undefined") {
  window.HTMLElement.prototype.scrollIntoView ??= function () {}
  window.HTMLElement.prototype.hasPointerCapture ??= () => false
  window.HTMLElement.prototype.releasePointerCapture ??= function () {}
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  window.matchMedia ??= ((q: string) =>
    ({
      matches: false,
      media: q,
      addEventListener() {},
      removeEventListener() {},
      onchange: null,
    }) as unknown as MediaQueryList) as typeof window.matchMedia
}
