import { useSyncExternalStore } from "react"

/** Phone layout breakpoint (matches Tailwind's `max-sm` and src/features/shell/phone.css). */
export const PHONE_QUERY = "(max-width: 640px)"

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {}
  const mq = window.matchMedia(PHONE_QUERY)
  mq.addEventListener("change", onChange)
  return () => mq.removeEventListener("change", onChange)
}

function snapshot() {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(PHONE_QUERY).matches
}

/** True at phone widths (≤ 640px), e.g. the Opal web UI opened on a paired phone. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
