import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Keeps a scroll container pinned to the bottom while its content grows (streaming), until the
 * user scrolls up. Returns refs for the scroll viewport and the content element, whether the view
 * is at the bottom, and a scrollToBottom() for the "scroll to bottom" pill.
 */
export function useStickToBottom(threshold = 72) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current
    if (!el) return
    stick.current = true
    setAtBottom(true)
    if (typeof el.scrollTo === "function")
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" })
    else el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      const bottom = dist < threshold
      stick.current = bottom
      setAtBottom(bottom)
    }
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        stick.current = false
      }
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    el.addEventListener("wheel", onWheel, { passive: true })
    return () => {
      el.removeEventListener("scroll", onScroll)
      el.removeEventListener("wheel", onWheel)
    }
  }, [threshold])

  useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => {
      if (stick.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
    ro.observe(content)
    // The viewport shrinks when the composer grows (attachments, permission cards).
    if (scrollRef.current) ro.observe(scrollRef.current)
    return () => ro.disconnect()
  }, [])

  return { scrollRef, contentRef, atBottom, scrollToBottom }
}
