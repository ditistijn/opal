import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** True when running inside the Tauri webview (false in the plain browser / tests). */
export function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

export function formatRelativeTime(ms: number, now = Date.now()) {
  const diff = Math.max(0, now - ms)
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "Just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
