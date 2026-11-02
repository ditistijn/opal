/** Polling helpers for the smoke harness: every wait has an overall timeout and a readable failure. */

export const POLL_MS = 250

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface WaitOptions {
  timeoutMs: number
  intervalMs?: number
  /** Describes the last observed state for the timeout message. */
  describe?: () => string
  /** Returns a message to stop waiting early with that error (e.g. a render error). */
  fail?: () => string | undefined
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object" && "message" in error)
    return String((error as { message: unknown }).message)
  return String(error)
}

/**
 * Resolves with the first non-undefined value of `probe`. Probe errors are retried (the last one is
 * reported on timeout).
 */
export async function waitFor<T>(
  what: string,
  probe: () => T | undefined | Promise<T | undefined>,
  options: WaitOptions,
): Promise<T> {
  const { timeoutMs, intervalMs = POLL_MS } = options
  const deadline = Date.now() + timeoutMs
  let lastError: string | undefined
  for (;;) {
    const failure = options.fail?.()
    if (failure) throw new Error(`${what}: ${failure}`)
    try {
      const value = await probe()
      if (value !== undefined) return value
      lastError = undefined
    } catch (error) {
      lastError = errorMessage(error)
    }
    if (Date.now() >= deadline) {
      const last = [options.describe?.(), lastError && `last error: ${lastError}`].filter(Boolean).join("; ")
      throw new Error(
        `timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${what}${last ? ` (${last})` : ""}`,
      )
    }
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())))
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
