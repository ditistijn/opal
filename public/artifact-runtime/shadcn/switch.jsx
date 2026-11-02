import { useState } from "react"
import { cn } from "@/lib/utils"
export function Switch({ className, checked, defaultChecked, onCheckedChange, disabled, ...p }) {
  const [inner, setInner] = useState(!!defaultChecked)
  const on = checked !== undefined ? checked : inner
  const toggle = () => {
    if (disabled) return
    if (checked === undefined) setInner(!on)
    onCheckedChange && onCheckedChange(!on)
  }
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={toggle}
      className={cn("inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors disabled:opacity-50", on ? "bg-neutral-900" : "bg-neutral-200", className)} {...p}>
      <span className={cn("block h-5 w-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-5" : "translate-x-0")} />
    </button>
  )
}
export default Switch
