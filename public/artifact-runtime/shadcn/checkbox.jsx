import { useState } from "react"
import { cn } from "@/lib/utils"
export function Checkbox({ className, checked, defaultChecked, onCheckedChange, disabled, ...p }) {
  const [inner, setInner] = useState(!!defaultChecked)
  const on = checked !== undefined ? !!checked : inner
  const toggle = () => {
    if (disabled) return
    if (checked === undefined) setInner(!on)
    onCheckedChange && onCheckedChange(!on)
  }
  return (
    <button type="button" role="checkbox" aria-checked={on} disabled={disabled} onClick={toggle}
      className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-sm border border-neutral-900 disabled:opacity-50", on ? "bg-neutral-900 text-white" : "bg-white", className)} {...p}>
      {on ? <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg> : null}
    </button>
  )
}
export default Checkbox
