import { useEffect, useRef } from "react"

export interface Hotkey {
  /** e.g. "mod+n", "mod+shift+a", "escape", "mod+,". `mod` = ⌘ on macOS, Ctrl elsewhere. */
  combo: string
  handler(e: KeyboardEvent): void
  /** Fire even when focus is in an input/textarea (default true for mod combos, false otherwise). */
  allowInInput?: boolean
  enabled?: boolean
}

const isMacPlatform = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

export function matchesCombo(e: KeyboardEvent, combo: string) {
  const parts = combo.toLowerCase().split("+")
  const key = parts.pop() ?? ""
  const mod = parts.includes("mod")
  const shift = parts.includes("shift")
  const alt = parts.includes("alt")
  const modPressed = isMacPlatform ? e.metaKey : e.ctrlKey
  if (mod !== modPressed) return false
  if (shift !== e.shiftKey) return false
  if (alt !== e.altKey) return false
  const k = e.key.toLowerCase()
  return k === key || (key === "escape" && k === "esc")
}

/** Global keyboard shortcuts bound on window. Handlers can change between renders without rebinding. */
export function useHotkeys(hotkeys: Hotkey[]) {
  const ref = useRef(hotkeys)
  ref.current = hotkeys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inInput =
        !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      for (const h of ref.current) {
        if (h.enabled === false) continue
        if (!matchesCombo(e, h.combo)) continue
        const allow = h.allowInInput ?? h.combo.includes("mod")
        if (inInput && !allow) continue
        e.preventDefault()
        h.handler(e)
        return
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}
