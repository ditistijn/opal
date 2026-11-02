import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

const KEY = "opal.chat.splitRatio"
const MIN_PX = 360

function loadRatio() {
  try {
    const v = Number(localStorage.getItem(KEY))
    return v > 0.2 && v < 0.8 ? v : 0.55
  } catch {
    return 0.55
  }
}

/** Horizontal split with a draggable divider; `ratio` is the right pane's share, persisted. */
export function SplitLayout({ left, right }: { left: ReactNode; right: ReactNode }) {
  const [ratio, setRatio] = useState(loadRatio)
  const [dragging, setDragging] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const onMove = useCallback((e: PointerEvent) => {
    const el = box.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const rightPx = Math.min(Math.max(rect.right - e.clientX, MIN_PX), rect.width - MIN_PX)
    setRatio(rightPx / rect.width)
  }, [])

  useEffect(() => {
    if (!dragging) return
    const up = () => setDragging(false)
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", up)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", up)
    }
  }, [dragging, onMove])

  useEffect(() => {
    if (dragging) return
    try {
      localStorage.setItem(KEY, String(ratio))
    } catch {}
  }, [ratio, dragging])

  return (
    <div ref={box} className="relative flex min-h-0 min-w-0 flex-1" data-testid="split">
      <div className="flex min-w-0 flex-col" style={{ width: `${(1 - ratio) * 100}%` }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize artifact panel"
        aria-valuenow={Math.round(ratio * 100)}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDoubleClick={() => setRatio(0.55)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setRatio((r) => Math.min(0.8, r + 0.02))
          if (e.key === "ArrowRight") setRatio((r) => Math.max(0.2, r - 0.02))
        }}
        className="group/sep relative z-10 w-px shrink-0 cursor-col-resize bg-border"
      >
        <span className="absolute inset-y-0 -left-[3px] -right-[3px] transition-colors duration-[120ms] group-hover/sep:bg-accent/30 group-focus-visible/sep:bg-accent/40" />
      </div>
      <div className="flex min-w-0 flex-col" style={{ width: `${ratio * 100}%` }}>
        {right}
      </div>
      {dragging ? <div className="fixed inset-0 z-50 cursor-col-resize" /> : null}
    </div>
  )
}
