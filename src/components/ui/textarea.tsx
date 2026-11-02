import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "selectable w-full resize-none rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-[14px] leading-relaxed text-fg placeholder:text-fg-muted transition-fast focus:border-accent/60 focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-ring/40",
        className,
      )}
      {...props}
    />
  )
}
