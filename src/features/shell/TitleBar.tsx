import { Menu } from "lucide-react"
import { useIsPhone } from "@/hooks/use-is-phone"
import { useSurface } from "@/hooks/use-surface"
import { cn } from "@/lib/utils"
import { usePhoneDrawer } from "./phone-drawer"
import { CodeStatusDot } from "@/features/code/CodeStatusDot"

/**
 * macOS title bar overlay: a drag region with the traffic-light inset on the left and the
 * Chat / Code surface switcher centered.
 * At phone widths (paired remote device) a hamburger on the left opens the sidebar drawer.
 */
export function TitleBar() {
  const { surface, setSurface } = useSurface()
  const phone = useIsPhone()
  return (
    <div
      data-tauri-drag-region
      className="opal-titlebar relative flex h-[var(--titlebar-height)] shrink-0 items-center justify-center bg-bg-sidebar"
    >
      {phone && surface === "chat" && (
        <button
          type="button"
          aria-label="Open sidebar"
          onClick={() => usePhoneDrawer.getState().toggle()}
          className="absolute bottom-1 left-2 flex size-9 items-center justify-center rounded-md text-fg-secondary hover:bg-bg-inset/70 hover:text-fg"
        >
          <Menu className="size-5" />
        </button>
      )}
      <div className="flex items-center rounded-md bg-bg-inset/60 p-0.5">
        {(["chat", "code"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSurface(s)}
            className={cn(
              "rounded-[5px] px-3 py-0.5 text-[12.5px] font-medium capitalize transition-fast",
              surface === s ? "bg-bg-elevated text-fg shadow-sm" : "text-fg-muted hover:text-fg",
            )}
          >
            {s}
          </button>
        ))}
      </div>
      <CodeStatusDot className="absolute right-3 top-1/2 -translate-y-1/2" />
    </div>
  )
}
