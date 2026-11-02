import { useEffect, useRef, useState, type RefObject } from "react"
import type { DroppedFile } from "@/lib/runtime"
import { isTauri } from "@/lib/utils"

export type DropHandler = (files: DroppedFile[], target: Element | null) => void

async function toDropped(file: File): Promise<DroppedFile> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return { name: file.name, mime: file.type || undefined, size: file.size, bytes }
}

/**
 * File drag-and-drop over an element. In the browser it uses HTML5 drag events (bytes);
 * inside Tauri the webview's native drag-drop event provides absolute paths instead.
 * `target` is the element under the drop point, so callers can route to drop zones.
 */
export function useFileDrop(ref: RefObject<HTMLElement | null>, onDrop: DropHandler, enabled = true) {
  const [dragging, setDragging] = useState(false)
  const [zone, setZone] = useState<string | null>(null)
  const handler = useRef(onDrop)
  handler.current = onDrop

  // HTML5 (browser / tests)
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    let depth = 0
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")
    const zoneAt = (t: EventTarget | null) =>
      (t instanceof Element ? t.closest("[data-drop-zone]")?.getAttribute("data-drop-zone") : null) ?? null
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setDragging(true)
    }
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
      setZone(zoneAt(e.target))
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      setZone(null)
      const target = e.target instanceof Element ? e.target : null
      const files = await Promise.all(Array.from(e.dataTransfer?.files ?? []).map(toDropped))
      if (files.length) handler.current(files, target)
    }
    el.addEventListener("dragenter", enter)
    el.addEventListener("dragover", over)
    el.addEventListener("dragleave", leave)
    el.addEventListener("drop", drop)
    return () => {
      el.removeEventListener("dragenter", enter)
      el.removeEventListener("dragover", over)
      el.removeEventListener("dragleave", leave)
      el.removeEventListener("drop", drop)
    }
  }, [ref, enabled])

  // Tauri native drag-drop (paths)
  useEffect(() => {
    if (!enabled || !isTauri()) return
    let unlisten: (() => void) | undefined
    let cancelled = false
    void import("@tauri-apps/api/webview").then(async ({ getCurrentWebview }) => {
      const off = await getCurrentWebview().onDragDropEvent((event) => {
        const p = event.payload
        const el = ref.current
        const at = (pos: { x: number; y: number }) => {
          const ratio = window.devicePixelRatio || 1
          return document.elementFromPoint(pos.x / ratio, pos.y / ratio)
        }
        if (p.type === "enter" || p.type === "over") {
          const target = at(p.position)
          const inside = !!el && !!target && el.contains(target)
          setDragging(inside)
          setZone(target?.closest("[data-drop-zone]")?.getAttribute("data-drop-zone") ?? null)
        } else if (p.type === "drop") {
          setDragging(false)
          setZone(null)
          const target = at(p.position)
          if (!el || !target || !el.contains(target)) return
          const files: DroppedFile[] = p.paths.map((path) => ({ name: path.split("/").pop() ?? path, path }))
          if (files.length) handler.current(files, target)
        } else setDragging(false)
      })
      if (cancelled) off()
      else unlisten = off
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [ref, enabled])

  return { dragging, zone }
}
