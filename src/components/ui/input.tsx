import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "selectable h-8 w-full rounded-md border border-border-strong bg-bg-elevated px-2.5 text-[13px] text-fg placeholder:text-fg-muted transition-fast focus:border-accent/60 focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-ring/40",
        className,
      )}
      {...props}
    />
  )
}
