import { useState } from "react"
import { cn } from "@/lib/utils"
// Single-thumb slider with the shadcn/Radix array API: value={[n]} onValueChange={([n]) => …}
export function Slider({ className, value, defaultValue, onValueChange, onValueCommit, min = 0, max = 100, step = 1, disabled, ...p }) {
  const [inner, setInner] = useState((defaultValue && defaultValue[0]) ?? min)
  const current = value !== undefined ? value[0] : inner
  return (
    <input type="range" min={min} max={max} step={step} value={current} disabled={disabled}
      onChange={(e) => { const n = Number(e.target.value); if (value === undefined) setInner(n); onValueChange && onValueChange([n]) }}
      onMouseUp={(e) => onValueCommit && onValueCommit([Number(e.currentTarget.value)])}
      className={cn("w-full accent-neutral-900", className)} {...p} />
  )
}
export default Slider
