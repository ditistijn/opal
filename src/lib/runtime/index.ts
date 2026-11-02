/**
 * Runtime implementation entrypoint. See ./contracts.ts for the surface.
 * Implemented in ./runtime.ts (stores) — this file only re-exports.
 * With VITE_OPAL_MOCK=1 the in-memory mock (./mock) is used instead (UI development).
 */
import type { Runtime } from "./contracts"
import { makeRuntime } from "./runtime"
import { makeMockRuntime } from "./mock"

export * from "./contracts"
export { remoteRuntime } from "./remote"
export { sandboxRuntime } from "./sandbox"
export const runtime: Runtime = import.meta.env.VITE_OPAL_MOCK === "1" ? makeMockRuntime() : makeRuntime()
