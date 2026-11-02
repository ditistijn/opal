/** Side effects inline widgets may trigger: prompts from `window.opal.sendPrompt` and "Ask Opal to fix". */
import { useDrafts } from "@/features/composer/drafts"
import { runtime } from "@/lib/runtime"

/** Longer widget prompts go to the composer for review instead of being sent (docs/INLINE-WIDGETS.md §2). */
export const DIRECT_PROMPT_MAX = 200
/** At most one widget prompt per second per widget. */
export const PROMPT_INTERVAL_MS = 1000

/** Handles `opal:prompt`: short text is sent as the user's next message, long text is put in the composer. */
export function sendWidgetPrompt(
  sessionID: string | undefined,
  text: string,
): "sent" | "drafted" | "ignored" {
  const clean = text.trim()
  if (!sessionID || !clean) return "ignored"
  if (clean.length > DIRECT_PROMPT_MAX) {
    useDrafts.getState().setText(sessionID, clean)
    return "drafted"
  }
  void runtime.sendPrompt(sessionID, { text: clean }).catch(() => {})
  return "sent"
}

export function askToFix(sessionID: string | undefined, what: string, message: string) {
  if (!sessionID) return
  void runtime
    .sendPrompt(sessionID, { text: `The inline ${what} failed to render: ${message}. Please fix it.` })
    .catch(() => {})
}

/** Rate limiter for widget prompts: returns false when called again within `intervalMs`. */
export function makeRateLimiter(intervalMs = PROMPT_INTERVAL_MS, now: () => number = Date.now) {
  let last = -Infinity
  return () => {
    const t = now()
    if (t - last < intervalMs) return false
    last = t
    return true
  }
}
