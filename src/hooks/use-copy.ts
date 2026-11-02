import { useCallback, useEffect, useRef, useState } from "react"

/** Copy text to the clipboard and expose a short-lived "copied" flag for the check icon. */
export function useCopy(timeout = 1400) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard?.writeText(text)
      } catch {
        // Clipboard can be unavailable (permissions / insecure context); still show feedback.
      }
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), timeout)
    },
    [timeout],
  )
  return { copied, copy }
}
