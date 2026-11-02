import { Loader2, RotateCcw } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { codeRuntime, type PtyHandle, type PtyStatus } from "@/lib/runtime/code"
import { isMac } from "@/lib/utils"
import { monoFont, xtermTheme } from "./xterm-theme"

/** Shortcuts the surface owns; xterm must not swallow them while it has focus. */
function isSurfaceShortcut(e: KeyboardEvent) {
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (!mod) return false
  const k = e.key.toLowerCase()
  return k === "n" || k === "`" || k === "," || (e.shiftKey && k === "d")
}

/**
 * xterm.js attached to one OpenCode PTY. xterm is loaded lazily (keeps it out of the main bundle and
 * out of jsdom tests). The terminal is themed from the Opal tokens and refits on resize; size changes
 * are pushed to the PTY with `pty.update`.
 */
export function XtermView({
  handle,
  visible,
  onRestart,
}: {
  handle: PtyHandle
  visible: boolean
  onRestart(): void
}) {
  const host = useRef<HTMLDivElement>(null)
  const api = useRef<{ fit(): void; focus(): void }>(undefined)
  const [status, setStatus] = useState<PtyStatus>("connecting")
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  useEffect(() => {
    const el = host.current
    if (!el) return
    let disposed = false
    const cleanups: (() => void)[] = []
    void (async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
        import("@xterm/xterm/css/xterm.css"),
      ])
      if (disposed) return
      const term = new Terminal({
        fontFamily: monoFont(),
        fontSize: 12.5,
        lineHeight: 1.25,
        cursorBlink: true,
        scrollback: 5000,
        macOptionIsMeta: true,
        allowTransparency: false,
        theme: xtermTheme(),
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, "_blank", "noopener")))
      term.attachCustomKeyEventHandler((e) => !isSurfaceShortcut(e))
      term.open(el)
      cleanups.push(() => term.dispose())

      let resizeTimer: ReturnType<typeof setTimeout> | undefined
      const pushSize = () => {
        clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => {
          void codeRuntime.pty.resize(handle, term.cols, term.rows).catch(() => undefined)
        }, 120)
      }
      const safeFit = () => {
        if (!visibleRef.current || !el.clientWidth || !el.clientHeight) return
        try {
          fit.fit()
        } catch {}
      }
      api.current = { fit: safeFit, focus: () => term.focus() }
      safeFit()

      const conn = codeRuntime.pty.connect(handle, {
        onData: (chunk) => term.write(chunk),
        onStatus: (s) => {
          setStatus(s)
          if (s === "open") pushSize()
        },
      })
      cleanups.push(() => conn.close())
      const input = term.onData((data) => conn.send(data))
      const resized = term.onResize(() => pushSize())
      cleanups.push(() => {
        input.dispose()
        resized.dispose()
        clearTimeout(resizeTimer)
      })

      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => safeFit())
        ro.observe(el)
        cleanups.push(() => ro.disconnect())
      }
      // Follow light/dark (data-theme on <html>).
      const mo = new MutationObserver(() => {
        term.options.theme = xtermTheme()
      })
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
      cleanups.push(() => mo.disconnect())
      if (visibleRef.current) term.focus()
    })()
    return () => {
      disposed = true
      api.current = undefined
      for (const fn of cleanups.reverse()) fn()
    }
  }, [handle])

  useEffect(() => {
    if (!visible) return
    const id = requestAnimationFrame(() => {
      api.current?.fit()
      api.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [visible])

  return (
    <div
      className={visible ? "relative flex min-h-0 flex-1 flex-col" : "hidden"}
      data-testid="terminal"
      data-status={status}
    >
      <div ref={host} className="opal-xterm min-h-0 flex-1 px-2 pt-1.5" />
      {status === "connecting" || status === "closed" ? (
        <div className="pointer-events-none absolute right-3 top-2 flex items-center gap-1.5 rounded-md bg-bg-elevated/90 px-2 py-1 text-[11.5px] text-fg-muted shadow-sm">
          <Loader2 className="size-3 animate-spin" />
          {status === "closed" ? "Reconnecting…" : "Connecting…"}
        </div>
      ) : null}
      {status === "exited" ? (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 border-t border-border bg-bg-elevated px-3 py-2 text-[12px] text-fg-secondary">
          <span>Process exited.</span>
          <Button size="xs" variant="outline" onClick={onRestart}>
            <RotateCcw />
            Restart
          </Button>
        </div>
      ) : null}
    </div>
  )
}
