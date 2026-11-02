import { useEffect, useState, type RefObject } from "react"

/** Observes an element's width (0 until measured; falls back to window width without ResizeObserver). */
export function useElementWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1280))
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof ResizeObserver === "undefined") {
      const onResize = () => setWidth(el.clientWidth || window.innerWidth)
      onResize()
      window.addEventListener("resize", onResize)
      return () => window.removeEventListener("resize", onResize)
    }
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}
