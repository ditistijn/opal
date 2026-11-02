import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] px-1 font-sans text-[11px] leading-none text-fg-muted",
        className,
      )}
      {...props}
    />
  )
}
