import { useEffect, type ReactNode } from "react"
import { create } from "zustand"
import { useNav } from "@/features/chat/nav-store"
import { cn } from "@/lib/utils"
import "./phone.css"

/** Open state of the phone sidebar drawer (title bar hamburger ↔ drawer). */
export const usePhoneDrawer = create<{ open: boolean; setOpen(open: boolean): void; toggle(): void }>(
  (set) => ({
    open: false,
    setOpen: (open) => set({ open }),
    toggle: () => set((s) => ({ open: !s.open })),
  }),
)

/** At phone widths the sidebar slides over the content; it closes on navigation, backdrop tap and Escape. */
export function PhoneDrawer({ children }: { children: ReactNode }) {
  const open = usePhoneDrawer((s) => s.open)
  const setOpen = usePhoneDrawer((s) => s.setOpen)
  const view = useNav((s) => s.view)

  useEffect(() => setOpen(false), [view, setOpen])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, setOpen])

  return (
    <>
      <div
        className={cn("opal-drawer-backdrop", open && "is-open")}
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div className={cn("opal-drawer", open && "is-open")} inert={!open} data-testid="phone-drawer">
        {children}
      </div>
    </>
  )
}
